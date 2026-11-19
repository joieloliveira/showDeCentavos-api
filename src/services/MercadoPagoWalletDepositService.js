import mongoose from "mongoose";
import WalletDeposit from "../models/WalletDeposit.js";
import WalletTransaction from "../models/WalletTransaction.js";
import User from "../models/User.js";
import { verifyWalletDepositPayment } from "./WalletDepositPaymentVerificationService.js";

/**
 * Confirma a cobrança diretamente no Mercado Pago ANTES de creditar saldo.
 * Mantém o fluxo manual_test existente completamente separado.
 */
export const processApprovedMercadoPagoWalletDeposit = async ({
  depositId,
  providerOrderId,
}) => {
  if (
    typeof depositId !== "string" ||
    !mongoose.isObjectIdOrHexString(depositId)
  ) {
    return { processed: false, reason: "INVALID_DEPOSIT_ID" };
  }

  const deposit = await WalletDeposit.findById(depositId).lean();
  if (!deposit || deposit.provider !== "mercadopago") {
    return { processed: false, reason: "DEPOSIT_NOT_FOUND" };
  }
  if (deposit.status === "approved" && deposit.processedAt) {
    return { processed: false, reason: "ALREADY_PROCESSED" };
  }
  if (deposit.status !== "pending" || deposit.processedAt) {
    return { processed: false, reason: "DEPOSIT_NOT_PENDING" };
  }

  // A consulta remota fica fora da transação do MongoDB.
  const verified = await verifyWalletDepositPayment({
    deposit,
    providerOrderId,
  });
  if (!verified.approved) {
    return { processed: false, reason: "PAYMENT_NOT_APPROVED" };
  }

  const session = await mongoose.startSession();
  let result = { processed: false, reason: "ALREADY_PROCESSED" };

  try {
    await session.withTransaction(async () => {
      // O driver pode executar este callback novamente após um conflito.
      // Não reutilizar resultado de uma tentativa anterior abortada.
      result = { processed: false, reason: "ALREADY_PROCESSED" };
      // Revalida o estado do depósito sob transação, inclusive o pagamento.
      const claimed = await WalletDeposit.findOneAndUpdate(
        {
          _id: deposit._id,
          provider: "mercadopago",
          status: "pending",
          processedAt: null,
          amountCents: verified.amountCents,
          $and: [
            { $or: [{ providerOrderId: verified.providerOrderId }, { providerOrderId: null }] },
            { $or: [{ providerPaymentId: null }, { providerPaymentId: verified.providerPaymentId }] },
          ],
        },
        {
          $set: {
            status: "approved",
            processedAt: new Date(),
            providerPaymentId: verified.providerPaymentId,
            providerOrderId: verified.providerOrderId,
          },
        },
        { session, returnDocument: "after" }
      );

      if (!claimed) return;

      const user = await User.findOneAndUpdate(
        { _id: claimed.user, isActive: true },
        { $inc: { "wallet.balanceCents": claimed.amountCents } },
        { session, returnDocument: "after" }
      );

      if (!user || !Number.isSafeInteger(user.wallet?.balanceCents)) {
        throw new Error("Usuário inválido ou saldo resultante inválido.");
      }

      await WalletTransaction.create(
        [{
          user: claimed.user,
          type: "deposit",
          amountCents: claimed.amountCents,
          balanceAfterCents: user.wallet.balanceCents,
          deposit: claimed._id,
          description: "Recarga PIX confirmada pelo Mercado Pago.",
        }],
        { session }
      );

      result = {
        processed: true,
        depositId: claimed._id,
        balanceAfterCents: user.wallet.balanceCents,
      };
    });
    return result;
  } finally {
    await session.endSession();
  }
};
