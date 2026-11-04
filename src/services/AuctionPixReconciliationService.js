import mongoose from "mongoose";
import AuctionWinnerPixAttempt from "../models/AuctionWinnerPixAttempt.js";
import AuctionWinnerPayment from "../models/AuctionWinnerPayment.js";
import AuctionFulfillment from "../models/AuctionFulfillment.js";
import MercadoPagoProvider from "./payments/MercadoPagoProvider.js";
import { adaptMercadoPagoAuctionPixOrder } from "./AuctionPixProviderVerificationService.js";
import { validateAuctionPixConfirmation } from "./auctionPixConfirmationPolicy.js";

// Read-only reconciliation. Never issues charges, changes states or concludes
// that a missing/failed lookup proves a provider charge does not exist.
export async function inspectAuctionPixProviderOutcome({ paymentId }) {
  if (!mongoose.isObjectIdOrHexString(paymentId)) {
    return { resolved: false, reason: "INVALID_INPUT" };
  }
  const attempt = await AuctionWinnerPixAttempt.findOne({ payment: paymentId }).lean();
  if (!attempt) return { resolved: false, reason: "ATTEMPT_NOT_FOUND" };
  if (!["request_unknown", "reconciliation_required"].includes(attempt.state)) {
    return { resolved: false, reason: "RECONCILIATION_NOT_REQUIRED" };
  }
  const payment = await AuctionWinnerPayment.findById(paymentId).lean();
  if (!payment || String(payment.auction) !== String(attempt.auction) ||
      payment.status !== "pending" || payment.provider !== "mercadopago") {
    return { resolved: false, reason: "INCONSISTENT_LOCAL_PAYMENT" };
  }
  // Without a known order ID, provider lookup by ID is impossible. A separate
  // trusted external-reference search/reconciliation workflow is required.
  if (!payment.providerOrderId) {
    return { resolved: false, reason: "PROVIDER_ORDER_ID_UNKNOWN", manualReview: true };
  }
  const fulfillment = await AuctionFulfillment.findById(payment.fulfillment).lean();
  if (!fulfillment) return { resolved: false, reason: "FULFILLMENT_NOT_FOUND" };
  let remote;
  try {
    remote = await MercadoPagoProvider.getOrder(String(payment.providerOrderId));
  } catch {
    return { resolved: false, reason: "PROVIDER_UNAVAILABLE", manualReview: true };
  }
  const order = adaptMercadoPagoAuctionPixOrder(remote);
  if (!order || String(order.orderId) !== String(payment.providerOrderId) ||
      String(order.externalReference) !== String(payment._id)) {
    return { resolved: false, reason: "PROVIDER_IDENTITY_MISMATCH", manualReview: true };
  }
  const decision = validateAuctionPixConfirmation({ payment, fulfillment, providerOrder: order });
  if (!decision.accepted) {
    return { resolved: false, reason: decision.reason, manualReview: true };
  }
  return {
    resolved: true,
    reason: "PROVIDER_APPROVED_VERIFIED",
    paymentId: String(payment._id),
    providerOrderId: String(order.orderId),
    // No mutation: separate verified confirmation must still commit atomically.
    action: "CONFIRM_USING_EXISTING_VERIFIED_PAYMENT_FLOW",
  };
}
