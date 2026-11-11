import MercadoPagoProvider from "./payments/MercadoPagoProvider.js";
import { validateAuctionPixConfirmation } from "./auctionPixConfirmationPolicy.js";

function toCents(value) {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(String(value));
  if (!match) return null;
  const cents = Number(match[1]) * 100 + Number((match[2] || "").padEnd(2, "0"));
  return Number.isSafeInteger(cents) ? cents : null;
}

// Converts the real MercadoPagoProvider.getOrder contract to the internal,
// strict PIX policy contract. Never accept client-supplied provider responses.
export function adaptMercadoPagoAuctionPixOrder(order) {
  if (!order || !order.raw || !Array.isArray(order.raw.transactions?.payments)) {
    return null;
  }
  const transactions = order.raw.transactions.payments;
  return {
    orderId: order.orderId,
    externalReference: order.externalReference,
    normalizedStatus: order.normalizedStatus,
    totalAmountCents: toCents(order.raw.total_amount),
    payment: {
      id: order.payment?.id,
      paymentMethodId: order.payment?.method,
    },
    transactions: transactions.map((tx) => ({
      id: tx.id == null ? null : String(tx.id),
      paymentMethodId: tx.payment_method?.id,
      status: tx.status === "processed" ? "approved" : tx.status,
      amountCents: toCents(tx.amount),
    })),
  };
}

export async function verifyAuctionPixWithProvider({ payment, fulfillment }) {
  if (!payment?.providerOrderId || payment.provider !== "mercadopago") {
    return { accepted: false, reason: "MISSING_PROVIDER_ORDER" };
  }
  // Remote lookup must happen before the MongoDB transaction.
  const response = await MercadoPagoProvider.getOrder(String(payment.providerOrderId));
  const providerOrder = adaptMercadoPagoAuctionPixOrder(response);
  if (!providerOrder) return { accepted: false, reason: "INVALID_PROVIDER_RESPONSE" };
  const decision = validateAuctionPixConfirmation({ payment, fulfillment, providerOrder });
  return { ...decision, ...(decision.accepted ? { providerOrder } : {}) };
}
