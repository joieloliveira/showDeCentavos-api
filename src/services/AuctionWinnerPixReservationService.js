import mongoose from "mongoose";
import AuctionWinnerPayment from "../models/AuctionWinnerPayment.js";
import AuctionFulfillment from "../models/AuctionFulfillment.js";
import AuctionWinnerPixAttempt from "../models/AuctionWinnerPixAttempt.js";
import { planAuctionWinnerPixCharge } from "./auctionWinnerPixChargePolicy.js";

// This reserves a logical charge locally. It NEVER calls Mercado Pago.
// A submitted attempt must be reconciled before any external charge is sent.
export async function reserveAuctionWinnerPixAttempt({ auction, winnerId, now = new Date() }) {
  if (!mongoose.isObjectIdOrHexString(auction?._id) ||
      !mongoose.isObjectIdOrHexString(winnerId)) {
    return { reserved: false, reason: "INVALID_INPUT" };
  }
  const session = await mongoose.startSession();
  try {
    let result = { reserved: false, reason: "NOT_ELIGIBLE" };
    await session.withTransaction(async () => {
      result = { reserved: false, reason: "NOT_ELIGIBLE" };
      const fulfillment = await AuctionFulfillment.findOne({
        auction: auction._id, winner: winnerId,
      }).session(session);
      const existing = await AuctionWinnerPayment.findOne({ auction: auction._id }).session(session);
      const plan = planAuctionWinnerPixCharge({ auction, fulfillment, payment: existing, winnerId, now });
      if (!plan.allowed) {
        result = { reserved: false, reason: plan.reason };
        return;
      }
      if (existing) {
        const claimed = await AuctionWinnerPayment.findOneAndUpdate({
          _id: existing._id, status: "not_started", processedAt: null,
          providerOrderId: null,
        }, { $set: { status: "pending" } }, { session, returnDocument: "after" });
        if (!claimed) return;
        result = { reserved: true, paymentId: String(claimed._id), logicalChargeKey: plan.logicalChargeKey };
      } else {
        const [created] = await AuctionWinnerPayment.create([{
          auction: auction._id, fulfillment: fulfillment._id, winner: winnerId,
          amountCents: plan.amountCents, currency: "BRL", provider: "mercadopago",
          status: "pending",
        }], { session });
        result = { reserved: true, paymentId: String(created._id), logicalChargeKey: plan.logicalChargeKey };
      }
      if (result.reserved) {
        const [attempt] = await AuctionWinnerPixAttempt.create([{
          payment: result.paymentId,
          auction: auction._id,
          idempotencyKey: `auction-winner-pix-${auction._id}`,
          state: "reserved",
        }], { session });
        result.idempotencyKey = attempt.idempotencyKey;
      }
    });
    return result;
  } catch (error) {
    // A competing reservation may win a unique index or transaction write conflict.
    // Never claim success or retry external charging from this outcome.
    if (error?.code === 11000 || error?.codeName === "WriteConflict" ||
        error?.hasErrorLabel?.("TransientTransactionError")) {
      return { reserved: false, reason: "CONCURRENT_RESERVATION" };
    }
    throw error;
  } finally {
    await session.endSession();
  }
}
