import mongoose from "mongoose";
import AuctionWinnerPayment from "../models/AuctionWinnerPayment.js";
import AuctionFulfillment from "../models/AuctionFulfillment.js";
import { validateAuctionPixConfirmation } from "./auctionPixConfirmationPolicy.js";

// Internal-only processor: providerOrder must come from a trusted, independently
// fetched provider response. Not exposed as an HTTP endpoint.
export async function processVerifiedAuctionPix({ paymentId, providerOrder }) {
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
      outcome = { processed: true, paymentId: String(payment._id) };
    });
    return outcome;
  } finally {
    await session.endSession();
  }
}
