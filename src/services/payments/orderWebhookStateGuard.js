// A delayed or duplicated webhook must not downgrade an already settled order.
// Refunds are handled separately; they must remain visible for reconciliation.
export function shouldIgnoreOrderWebhookState(order, normalizedStatus) {
  if (!order) return false;
  if (normalizedStatus === "refunded") return false;
  if (order.paymentStatus === "refunded") return true;
  if (order.paymentStatus === "paid" || order.payment?.processedAt) {
    return normalizedStatus !== "approved";
  }
  return false;
}

export function canCancelReservedOrder(order) {
  return Boolean(order &&
    order.paymentStatus !== "paid" &&
    order.paymentStatus !== "refunded" &&
    !order.payment?.processedAt);
}
