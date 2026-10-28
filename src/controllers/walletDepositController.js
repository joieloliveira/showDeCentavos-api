import mongoose from "mongoose";
import User from "../models/User.js";
import WalletDeposit from "../models/WalletDeposit.js";
import {
  createWalletPixCharge,
  generateWalletPixIdempotencyKey,
} from "../services/WalletPixChargeService.js";
import { processApprovedMercadoPagoWalletDeposit } from "../services/MercadoPagoWalletDepositService.js";

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

    await WalletDeposit.updateOne(
      { _id: deposit._id, provider: "mercadopago" },
      {
        $set: {
          providerOrderId: charge.providerOrderId,
          providerPaymentId: charge.providerPaymentId,
          chargeStatus: "resolved",
          pix: charge.pix,
        },
      }
    );

    // A cobrança pode ter sido aprovada antes do retorno da API.
    if (charge.status === "processed") {
      await processApprovedMercadoPagoWalletDeposit({
        depositId: String(deposit._id),
        providerOrderId: charge.providerOrderId,
      });
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
