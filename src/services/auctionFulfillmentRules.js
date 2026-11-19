// Pure rules only. These functions never initiate payments or write to MongoDB.
export const DEFAULT_PAYMENT_WINDOW_HOURS = 48;

export function calculatePaymentDeadline(wonAt, windowHours = DEFAULT_PAYMENT_WINDOW_HOURS) {
  const timestamp = new Date(wonAt).getTime();
  if (!Number.isFinite(timestamp)) throw new Error("Data de vitória inválida.");
  if (!Number.isInteger(windowHours) || windowHours < 1 || windowHours > 720) {
    throw new Error("Prazo de pagamento inválido.");
  }
  return new Date(timestamp + windowHours * 60 * 60 * 1000);
}

export function paymentWindowState({ wonAt, paymentStatus = "not_started", now = new Date(), windowHours = DEFAULT_PAYMENT_WINDOW_HOURS }) {
  if (paymentStatus === "paid") return "paid";
  if (["failed", "refunded", "cancelled"].includes(paymentStatus)) return paymentStatus;
  const deadline = calculatePaymentDeadline(wonAt, windowHours);
  const current = new Date(now).getTime();
  if (!Number.isFinite(current)) throw new Error("Data atual inválida.");
  return current > deadline.getTime() ? "expired" : "awaiting_payment";
}

export function canPrepareDelivery({ paymentStatus, deliveryStatus }) {
  return paymentStatus === "paid" && deliveryStatus === "not_started";
}

export function canMarkDelivered({ paymentStatus, deliveryStatus }) {
  return paymentStatus === "paid" && deliveryStatus === "shipped";
}
