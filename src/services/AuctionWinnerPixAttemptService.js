import mongoose from "mongoose";
import AuctionWinnerPixAttempt from "../models/AuctionWinnerPixAttempt.js";

// Mark an outbound request as ambiguous BEFORE any future provider HTTP call.
// No automatic retry is allowed while the outcome is unknown.
export async function markAuctionPixRequestUnknown({ paymentId, reason = "PROVIDER_OUTCOME_UNKNOWN" }) {
  if (!mongoose.isObjectIdOrHexString(paymentId)) {
    return { updated: false, reason: "INVALID_INPUT" };
  }
  const attempt = await AuctionWinnerPixAttempt.findOneAndUpdate(
    { payment: paymentId, state: "reserved" },
    { $set: { state: "request_unknown", lastError: String(reason).slice(0, 200) } },
    { returnDocument: "after" }
  );
  return attempt
    ? { updated: true, idempotencyKey: attempt.idempotencyKey, state: attempt.state }
    : { updated: false, reason: "NOT_RESERVED_OR_ALREADY_TRANSITIONED" };
}

export async function requireAuctionPixReconciliation({ paymentId }) {
  if (!mongoose.isObjectIdOrHexString(paymentId)) {
    return { updated: false, reason: "INVALID_INPUT" };
  }
  const attempt = await AuctionWinnerPixAttempt.findOneAndUpdate(
    { payment: paymentId, state: "request_unknown" },
    { $set: { state: "reconciliation_required" } },
    { returnDocument: "after" }
  );
  return attempt
    ? { updated: true, state: attempt.state }
    : { updated: false, reason: "NOT_AWAITING_RECONCILIATION" };
}
