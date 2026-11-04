import mongoose from "mongoose";
import AuctionWinnerPixAttempt from "../models/AuctionWinnerPixAttempt.js";
import AuctionWinnerPayment from "../models/AuctionWinnerPayment.js";
import AuctionFulfillment from "../models/AuctionFulfillment.js";
import { verifyAuctionPixWithProvider } from "./AuctionPixProviderVerificationService.js";
import { processVerifiedAuctionPix } from "./AuctionWinnerPaymentService.js";

// Internal-only, feature-gated reconciliation. Fetches independently from provider.
// Never creates charges, never retries an ambiguous provider request.
export async function reconcileVerifiedAuctionPix({ paymentId }) {
  if (process.env.AUCTION_PIX_RECONCILIATION_WRITES_ENABLED !== "true") {
    return { processed: false, reason: "FEATURE_DISABLED" };
  }
  if (!mongoose.isObjectIdOrHexString(paymentId)) {
    return { processed: false, reason: "INVALID_INPUT" };
  }
  const attempt = await AuctionWinnerPixAttempt.findOne({ payment: paymentId });
  if (!attempt || !["request_unknown", "reconciliation_required"].includes(attempt.state)) {
    return { processed: false, reason: "RECONCILIATION_NOT_REQUIRED" };
  }
  const payment = await AuctionWinnerPayment.findById(paymentId);
  if (!payment || String(payment.auction) !== String(attempt.auction) ||
      payment.status !== "pending" || !payment.providerOrderId) {
    return { processed: false, reason: "INCONSISTENT_LOCAL_PAYMENT" };
  }
  const fulfillment = await AuctionFulfillment.findById(payment.fulfillment);
  if (!fulfillment) return { processed: false, reason: "FULFILLMENT_NOT_FOUND" };
  let verification;
  try {
    verification = await verifyAuctionPixWithProvider({ payment, fulfillment });
  } catch {
    return { processed: false, reason: "PROVIDER_UNAVAILABLE" };
  }
  if (!verification.accepted) {
    return { processed: false, reason: verification.reason };
  }
  // Existing processor verifies again within its MongoDB transaction.
  const result = await processVerifiedAuctionPix({
    paymentId: String(payment._id), providerOrder: verification.providerOrder,
  });
  // Attempt state remains reconciliation_required until a separate audited
  // finalization step is implemented; never silently clear a safety lock.
  return result;
}
