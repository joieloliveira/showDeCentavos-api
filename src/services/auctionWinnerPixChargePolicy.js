import { calculatePaymentDeadline } from "./auctionFulfillmentRules.js";

// Pure preflight for a future PIX charge. This function never writes to MongoDB,
// contacts a provider, or enables a checkout.
export function planAuctionWinnerPixCharge({ auction, fulfillment, payment = null, winnerId, now = new Date() }) {
  if (!auction || !winnerId || auction.status !== "finished" ||
      String(auction.winner || "") !== String(winnerId)) {
    return { allowed: false, reason: "NOT_WINNER" };
  }
  if (!fulfillment || String(fulfillment.auction) !== String(auction._id) ||
      String(fulfillment.winner) !== String(winnerId) ||
      !auction.endsAt || Number.isNaN(new Date(auction.endsAt).getTime())) {
    return { allowed: false, reason: "INVALID_FULFILLMENT" };
  }
  if (!Number.isSafeInteger(auction.currentPriceCents) ||
      auction.currentPriceCents <= 0 ||
      !Number.isSafeInteger(fulfillment.winningPriceCents) ||
      fulfillment.winningPriceCents !== auction.currentPriceCents) {
    return { allowed: false, reason: "AMOUNT_MISMATCH" };
  }
  const deadline = calculatePaymentDeadline(auction.endsAt);
  if (!deadline || !Number.isFinite(new Date(now).getTime()) ||
      new Date(now).getTime() > new Date(deadline).getTime()) {
    return { allowed: false, reason: "PAYMENT_WINDOW_EXPIRED" };
  }
  if (fulfillment.paymentStatus === "paid") return { allowed: false, reason: "ALREADY_PAID" };
  if (!["not_started", "pending"].includes(fulfillment.paymentStatus)) {
    return { allowed: false, reason: "INVALID_PAYMENT_STATE" };
  }
  if (payment) {
    if (String(payment.auction) !== String(auction._id) ||
        String(payment.fulfillment) !== String(fulfillment._id) ||
        String(payment.winner) !== String(winnerId) ||
        payment.amountCents !== auction.currentPriceCents ||
        payment.currency !== "BRL" || payment.provider !== "mercadopago") {
      return { allowed: false, reason: "PAYMENT_RECORD_MISMATCH" };
    }
    if (payment.status === "paid" || payment.processedAt) {
      return { allowed: false, reason: "ALREADY_PAID" };
    }
    if (payment.providerOrderId || payment.status === "pending") {
      return { allowed: false, reason: "EXISTING_CHARGE" };
    }
    if (payment.status !== "not_started") {
      return { allowed: false, reason: "MANUAL_RECONCILIATION_REQUIRED" };
    }
  }
  return {
    allowed: true,
    auctionId: String(auction._id),
    fulfillmentId: String(fulfillment._id),
    winnerId: String(winnerId),
    amountCents: auction.currentPriceCents,
    currency: "BRL",
    provider: "mercadopago",
    paymentDeadline: deadline,
    // Stable logical key; actual provider idempotency requires a persisted attempt.
    logicalChargeKey: `auction-winner-pix:${auction._id}`,
    checkoutEnabled: false,
  };
}
