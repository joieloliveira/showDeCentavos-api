import axios from "axios";
import { v4 as uuidv4 } from "uuid";

const client = axios.create({
  baseURL: "https://api.mercadopago.com",
  timeout: 15000,
});

export const generateWalletPixIdempotencyKey = () => uuidv4();

export const createWalletPixCharge = async ({ deposit, email, idempotencyKey }) => {
  if (!Number.isSafeInteger(deposit.amountCents) || deposit.amountCents < 100) {
    throw new Error("Valor da recarga inválido.");
  }
  if (!process.env.MERCADOPAGO_ACCESS_TOKEN) {
    throw new Error("Credencial do Mercado Pago não configurada.");
  }

  const total = (deposit.amountCents / 100).toFixed(2);
  const { data } = await client.post("/v1/orders", {
    type: "online",
    processing_mode: "automatic",
    external_reference: String(deposit._id),
    total_amount: total,
    payer: { email },
    transactions: {
      payments: [{
        amount: total,
        expiration_time: "PT30M",
        payment_method: { id: "pix", type: "bank_transfer" },
      }],
    },
  }, {
    headers: {
      Authorization: `Bearer ${process.env.MERCADOPAGO_ACCESS_TOKEN}`,
      "X-Idempotency-Key": idempotencyKey,
    },
  });

  if (!data?.id || String(data.external_reference) !== String(deposit._id)) {
    throw new Error("Cobrança PIX retornou referência inválida.");
  }

  const payment = data.transactions?.payments?.[0];
  return {
    providerOrderId: String(data.id),
    providerPaymentId: payment?.id ? String(payment.id) : null,
    status: data.status,
    pix: {
      qrCode: payment?.payment_method?.qr_code ?? null,
      qrCodeBase64: payment?.payment_method?.qr_code_base64 ?? null,
      ticketUrl: payment?.payment_method?.ticket_url ?? null,
    },
  };
};
