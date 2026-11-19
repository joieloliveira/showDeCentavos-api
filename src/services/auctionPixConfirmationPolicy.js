// Pure provider confirmation policy; not connected to live payment routes.
export function validateAuctionPixConfirmation({ payment, fulfillment, providerOrder }) {
  if (!payment || !fulfillment || !providerOrder) return { accepted: false, reason: "MISSING_DATA" };
  if (payment.status === "paid" && payment.processedAt) return { accepted: false, reason: "ALREADY_PROCESSED" };
  if (payment.status !== "pending" || fulfillment.paymentStatus !== "pending") {
    return { accepted: false, reason: "INVALID_STATE" };
  }
  if (payment.provider !== "mercadopago" || payment.currency !== "BRL" ||
      !Number.isSafeInteger(payment.amountCents) || payment.amountCents <= 0 ||
      !Number.isSafeInteger(fulfillment.winningPriceCents) ||
      payment.amountCents !== fulfillment.winningPriceCents) {
    return { accepted: false, reason: "INVALID_AMOUNT" };
  }
  if (String(payment.auction) !== String(fulfillment.auction) ||
      String(payment.fulfillment) !== String(fulfillment._id) ||
      String(payment.winner) !== String(fulfillment.winner)) {
    return { accepted: false, reason: "OWNER_MISMATCH" };
  }
  if (!payment.providerOrderId ||
      String(payment.providerOrderId) !== String(providerOrder.orderId) ||
      String(providerOrder.externalReference) !== String(payment._id)) {
    return { accepted: false, reason: "REFERENCE_MISMATCH" };
  }
  if (providerOrder.normalizedStatus !== "approved" ||
      providerOrder.payment?.paymentMethodId !== "pix" ||
      !providerOrder.payment?.id ||
      !Array.isArray(providerOrder.transactions) ||
      providerOrder.transactions.length !== 1 ||
      providerOrder.transactions[0]?.paymentMethodId !== "pix" ||
      providerOrder.transactions[0]?.status !== "approved" ||
      String(providerOrder.transactions[0]?.id) !== String(providerOrder.payment.id)) {
    return { accepted: false, reason: "UNVERIFIED_PIX" };
  }
  const total = providerOrder.totalAmountCents;
  const transactionAmount = providerOrder.transactions[0].amountCents;
  if (!Number.isSafeInteger(total) || total !== payment.amountCents ||
      !Number.isSafeInteger(transactionAmount) || transactionAmount !== payment.amountCents) {
    return { accepted: false, reason: "AMOUNT_MISMATCH" };
  }
  return { accepted: true };
}
