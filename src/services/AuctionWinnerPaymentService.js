import mongoose from "mongoose";
import AuctionWinnerPayment from "../models/AuctionWinnerPayment.js";
import AuctionFulfillment from "../models/AuctionFulfillment.js";
import AuctionWinnerPixAttempt from "../models/AuctionWinnerPixAttempt.js";
import { validateAuctionPixConfirmation } from "./auctionPixConfirmationPolicy.js";

// Internal-only processor: providerOrder must come from a trusted, independently
// fetched provider response. Not exposed as an HTTP endpoint.
export async function processVerifiedAuctionPix({ paymentId, providerOrder, reconcileAttempt = false }) {
  if (!mongoose.isObjectIdOrHexString(paymentId) || !providerOrder) {
    return { processed: false, reason: "INVALID_INPUT" };
  }
  const session = await mongoose.startSession();
  try {
    let outcome = { processed: false, reason: "NOT_ELIGIBLE" };
    await session.withTransaction(async () => {
      // withTransaction may retry its callback after a transient write conflict.
      outcome = { processed: false, reason: "NOT_ELIGIBLE" };
      const payment = await AuctionWinnerPayment.findById(paymentId).session(session);
      if (!payment) return;
      const fulfillment = await AuctionFulfillment.findById(payment.fulfillment).session(session);
      const decision = validateAuctionPixConfirmation({ payment, fulfillment, providerOrder });
      if (!decision.accepted) {
        outcome = { processed: false, reason: decision.reason };
        return;
      }
      // Never let the ordinary webhook bypass a durable ambiguous attempt.
      // Such an attempt must go through independently verified reconciliation.
      if (!reconcileAttempt) {
        const ambiguous = await AuctionWinnerPixAttempt.exists({
          payment: payment._id, auction: payment.auction,
          state: { $in: ["request_unknown", "reconciliation_required"] },
        }).session(session);
        if (ambiguous) {
          outcome = { processed: false, reason: "RECONCILIATION_REQUIRED" };
          return;
        }
      }
      if (reconcileAttempt) {
        const attempt = await AuctionWinnerPixAttempt.findOne({
          payment: payment._id, auction: payment.auction,
          state: { $in: ["request_unknown", "reconciliation_required"] },
        }).session(session);
        if (!attempt || (attempt.providerOrderId &&
            String(attempt.providerOrderId) !== String(providerOrder.orderId))) {
          outcome = { processed: false, reason: "RECONCILIATION_ATTEMPT_MISMATCH" };
          return;
        }
      }
      const claimed = await AuctionWinnerPayment.findOneAndUpdate({
        _id: payment._id, status: "pending", processedAt: null,
        providerOrderId: String(providerOrder.orderId)
      }, {
        $set: {
          status: "paid", processedAt: new Date(),
          providerPaymentId: String(providerOrder.payment.id)
        }
      }, { session, returnDocument: "after" });
      if (!claimed) return;
      const updated = await AuctionFulfillment.updateOne({
        _id: fulfillment._id, auction: payment.auction, winner: payment.winner,
        winningPriceCents: payment.amountCents, paymentStatus: "pending"
      }, { $set: { paymentStatus: "paid" } }, { session });
      if (updated.modifiedCount !== 1) {
        throw new Error("Fulfillment payment transition failed; rolling back charge confirmation.");
      }
      if (reconcileAttempt) {
        const attemptUpdate = await AuctionWinnerPixAttempt.updateOne({
          payment: payment._id, auction: payment.auction,
          state: { $in: ["request_unknown", "reconciliation_required"] },
          $or: [{ providerOrderId: null }, { providerOrderId: String(providerOrder.orderId) }],
        }, {
          $set: { state: "provider_confirmed", providerOrderId: String(providerOrder.orderId), lastError: null },
        }, { session });
        if (attemptUpdate.modifiedCount !== 1) {
          throw new Error("PIX attempt finalization failed; rolling back payment confirmation.");
        }
      }
      if (!reconcileAttempt) {
        // Older payments without an attempt remain compatible. For new reserved
        // payments, finalize the attempt in the same transaction as the credit.
        await AuctionWinnerPixAttempt.updateOne({
          payment: payment._id, auction: payment.auction, state: "reserved",
          $or: [{ providerOrderId: null }, { providerOrderId: String(providerOrder.orderId) }],
        }, {
          $set: { state: "provider_confirmed", providerOrderId: String(providerOrder.orderId), lastError: null },
        }, { session });
      }
      outcome = { processed: true, paymentId: String(payment._id) };
    });
    return outcome;
  } finally {
    await session.endSession();
  }
}
