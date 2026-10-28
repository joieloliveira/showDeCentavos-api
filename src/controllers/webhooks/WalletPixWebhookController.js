import { WebhookSignatureValidator, InvalidWebhookSignatureError } from "mercadopago";
import mongoose from "mongoose";
import WalletDeposit from "../../models/WalletDeposit.js";
import MercadoPagoProvider from "../../services/payments/MercadoPagoProvider.js";
import { processApprovedMercadoPagoWalletDeposit } from "../../services/MercadoPagoWalletDepositService.js";

export const walletPixWebhook = async (req, res) => {
  try {
    const orderId = String(req.query["data.id"] ?? req.body?.data?.id ?? "");
    const type = req.query.type ?? req.body?.type;
    if (!orderId) return res.sendStatus(200);
    if (
      !req.headers["x-signature"] ||
      !req.headers["x-request-id"] ||
      !process.env.MERCADOPAGO_WEBHOOK_SECRET
    ) return res.sendStatus(401);

    WebhookSignatureValidator.validate({
      xSignature: req.headers["x-signature"],
      xRequestId: req.headers["x-request-id"],
      dataId: orderId,
      secret: process.env.MERCADOPAGO_WEBHOOK_SECRET,
    });

    if (type && type !== "order") return res.sendStatus(200);
    if (orderId.startsWith("PAY")) return res.sendStatus(200);

    const providerOrder = await MercadoPagoProvider.getOrder(orderId);
    if (!mongoose.isObjectIdOrHexString(providerOrder.externalReference)) {
      return res.sendStatus(200);
    }
    const deposit = await WalletDeposit.findOne({
      _id: providerOrder.externalReference,
      provider: "mercadopago",
      $or: [{ providerOrderId: orderId }, { providerOrderId: null }],
    });
    if (!deposit) return res.sendStatus(200);

    if (providerOrder.normalizedStatus === "approved") {
      await processApprovedMercadoPagoWalletDeposit({
        depositId: String(deposit._id),
        providerOrderId: orderId,
      });
    }
    return res.sendStatus(200);
  } catch (error) {
    if (error instanceof InvalidWebhookSignatureError) {
      return res.sendStatus(401);
    }
    console.error("Erro no webhook de recarga PIX:", error.message);
    return res.sendStatus(500);
  }
};
