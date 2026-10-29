import mongoose from "mongoose";
import User from "../models/User.js";
import WalletDeposit from "../models/WalletDeposit.js";
import {
  createWalletPixCharge,
  generateWalletPixIdempotencyKey,
} from "../services/WalletPixChargeService.js";
import { processApprovedMercadoPagoWalletDeposit } from "../services/MercadoPagoWalletDepositService.js";
import { recoverWalletPixOrder } from "../services/WalletPixOrderRecoveryService.js";

const publicDeposit = (deposit) => ({
  id: deposit._id,
  amountCents: deposit.amountCents,
  status: deposit.status,
  provider: deposit.provider,
  createdAt: deposit.createdAt,
  processedAt: deposit.processedAt,
  pix: deposit.pix ?? null,
});

export const createWalletPixDeposit = async (req, res) => {
  // Fail closed: never call the payment provider unless explicitly enabled.
  // The frontend's disabled button is not a security boundary.
  if (process.env.WALLET_PIX_CHARGES_ENABLED !== "true") {
    return res.status(503).json({
      message: "Recargas PIX ainda não estão habilitadas.",
    });
  }
  try {
    const { amountCents } = req.body ?? {};
    if (!Number.isSafeInteger(amountCents) || amountCents < 100 || amountCents > 100000) {
      return res.status(400).json({
        message: "Informe amountCents inteiro entre 100 e 100000.",
      });
    }

    const user = await User.findOne({ _id: req.user.id, isActive: true })
      .select("email");
    if (!user?.email) {
      return res.status(403).json({ message: "Usuário sem e-mail ativo." });
    }

    const idempotencyKey = generateWalletPixIdempotencyKey();
    const deposit = await WalletDeposit.create({
      user: user._id,
      amountCents,
      provider: "mercadopago",
      status: "pending",
      idempotencyKey,
      chargeStatus: "submitted",
    });

    // A chamada pode ser concluída no provedor mesmo em caso de timeout.
    // Preservamos a tentativa; não criamos automaticamente outra cobrança.
    let charge;
    try {
      charge = await createWalletPixCharge({
        deposit,
        email: user.email,
        idempotencyKey,
      });
    } catch (error) {
      console.error("Resultado da cobrança de recarga desconhecido:", error.response?.status || error.message);
      return res.status(202).json({
        depositId: deposit._id,
        status: "confirmation_pending",
        message: "Resultado da criação do PIX não confirmado. Consulte o depósito antes de tentar novamente.",
      });
    }

    // Um webhook pode aprovar o depósito enquanto a criação do PIX retorna.
    // Não sobrescrevemos um pagamento já vinculado pelo webhook.
    const chargeFields = {
      providerOrderId: charge.providerOrderId,
      chargeStatus: "resolved",
      pix: charge.pix,
    };
    if (charge.providerPaymentId) {
      chargeFields.providerPaymentId = charge.providerPaymentId;
    }
    const saved = await WalletDeposit.findOneAndUpdate(
      {
        _id: deposit._id,
        provider: "mercadopago",
        $and: [
          { $or: [{ providerOrderId: null }, { providerOrderId: charge.providerOrderId }] },
          ...(charge.providerPaymentId
            ? [{ $or: [{ providerPaymentId: null }, { providerPaymentId: charge.providerPaymentId }] }]
            : []),
        ],
      },
      { $set: chargeFields },
      { returnDocument: "after" }
    );
    if (!saved) {
      throw new Error("Cobrança diverge do depósito registrado.");
    }

    // Confirma também cobranças aprovadas antes do retorno da API.
    // A verificação consulta novamente o provedor e não confia no status da resposta inicial.
    if (charge.status === "processed") {
      try {
        await processApprovedMercadoPagoWalletDeposit({
          depositId: String(deposit._id),
          providerOrderId: charge.providerOrderId,
        });
      } catch (error) {
        console.error("Recarga criada, mas confirmação pendente:", error.message);
        return res.status(202).json({
          depositId: deposit._id,
          status: "confirmation_pending",
          message: "Cobrança criada. A confirmação do crédito está pendente.",
        });
      }
    }

    const updated = await WalletDeposit.findById(deposit._id);
    return res.status(201).json({ deposit: publicDeposit(updated) });
  } catch (error) {
    console.error("Erro ao criar recarga PIX:", error);
    return res.status(500).json({ message: "Erro ao criar recarga PIX." });
  }
};

export const getWalletDeposit = async (req, res) => {
  if (!mongoose.isObjectIdOrHexString(req.params.depositId)) {
    return res.status(400).json({ message: "ID inválido." });
  }
  try {
    const deposit = await WalletDeposit.findOne({
      _id: req.params.depositId,
      user: req.user.id,
    });
    if (!deposit) return res.status(404).json({ message: "Depósito não encontrado." });
    return res.json({ deposit: publicDeposit(deposit) });
  } catch (error) {
    console.error("Erro ao consultar depósito:", error);
    return res.status(500).json({ message: "Erro ao consultar depósito." });
  }
};

/**
 * Reconciliação sob demanda para cobrança PIX já identificada.
 * Nunca aceita identificador de pagamento informado pelo cliente.
 */
export const reconcileWalletPixDeposit = async (req, res) => {
  if (!mongoose.isObjectIdOrHexString(req.params.depositId)) {
    return res.status(400).json({ message: "ID inválido." });
  }

  try {
    const deposit = await WalletDeposit.findOne({
      _id: req.params.depositId,
      user: req.user.id,
      provider: "mercadopago",
    });
    if (!deposit) {
      return res.status(404).json({ message: "Depósito não encontrado." });
    }

    let recovery = null;
    if (deposit.status === "pending") {
      let providerOrderId = deposit.providerOrderId;
      if (!providerOrderId) {
        recovery = await recoverWalletPixOrder(deposit);
        providerOrderId = recovery.providerOrderId ?? null;
      }
      if (providerOrderId) {
        await processApprovedMercadoPagoWalletDeposit({
          depositId: String(deposit._id),
          providerOrderId,
        });
      }
    }

    const updated = await WalletDeposit.findOne({
      _id: deposit._id,
      user: req.user.id,
    });
    return res.json({
      deposit: publicDeposit(updated),
      reconciliationPending: updated.status === "pending" && !updated.providerOrderId,
      recoveryReason: recovery?.recovered === false ? recovery.reason : null,
    });
  } catch (error) {
    console.error("Erro na reconciliação da recarga PIX:", error.message);
    return res.status(503).json({
      message: "Não foi possível confirmar o pagamento agora. Tente novamente mais tarde.",
    });
  }
};
