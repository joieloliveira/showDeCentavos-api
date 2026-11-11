import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import AuctionWinnerPayment from "../models/AuctionWinnerPayment.js";
import AuctionWinnerPixAttempt from "../models/AuctionWinnerPixAttempt.js";
import AuctionFulfillment from "../models/AuctionFulfillment.js";
import { reserveAuctionWinnerPixAttempt } from "../services/AuctionWinnerPixReservationService.js";
import { processVerifiedAuctionPix } from "../services/AuctionWinnerPaymentService.js";

const uri = process.env.WALLET_TEST_MONGODB_URI || "";
const safe = /^mongodb:\/\/127\.0\.0\.1:27018\/wallet_test_pix\?/.test(uri) &&
  /(?:\?|&)replicaSet=walletTestRS(?:&|$)/.test(uri) &&
  !/@|authSource=|directConnection=/.test(uri);

if (!safe) {
  test("reservation-to-confirmation integration requires isolated local replica set", {
    skip: "Set WALLET_TEST_MONGODB_URI for walletTestRS:27018",
  }, () => {});
} else {
  test("reserved winner PIX reaches paid state once after verified provider response", async () => {
    await mongoose.connect(uri, {
      dbName: `pix_reserve_confirm_${process.pid}_${Date.now()}`,
      serverSelectionTimeoutMS: 5000,
    });
    try {
      const auctionId = new mongoose.Types.ObjectId();
      const winner = new mongoose.Types.ObjectId();
      const endsAt = new Date(Date.now() - 60_000);
      const auction = {
        _id: auctionId, winner, status: "finished",
        currentPriceCents: 325, endsAt,
      };
      const fulfillment = await AuctionFulfillment.create({
        auction: auctionId, winner, product: new mongoose.Types.ObjectId(),
        winningPriceCents: 325, wonAt: endsAt, paymentStatus: "not_started",
      });
      const reserved = await reserveAuctionWinnerPixAttempt({ auction, winnerId: winner });
      assert.equal(reserved.reserved, true);
      const payment = await AuctionWinnerPayment.findById(reserved.paymentId);
      const attempt = await AuctionWinnerPixAttempt.findOne({ payment: payment._id });
      assert.equal(payment.status, "pending");
      assert.equal(attempt.state, "reserved");
      assert.equal(attempt.idempotencyKey, reserved.idempotencyKey);
      assert.equal((await AuctionFulfillment.findById(fulfillment._id)).paymentStatus, "pending");

      // Simulate a previously associated provider order; never send a real PIX request.
      const providerOrderId = `ORDER-${auctionId}`;
      const bound = await AuctionWinnerPayment.updateOne({
        _id: payment._id, status: "pending", providerOrderId: null,
      }, { $set: { providerOrderId } });
      assert.equal(bound.modifiedCount, 1);
      const providerOrder = {
        orderId: providerOrderId, externalReference: String(payment._id),
        normalizedStatus: "approved", totalAmountCents: 325,
        payment: { id: `PIX-${auctionId}`, paymentMethodId: "pix" },
        transactions: [{
          id: `PIX-${auctionId}`, status: "approved",
          paymentMethodId: "pix", amountCents: 325,
        }],
      };
      const confirmed = await processVerifiedAuctionPix({
        paymentId: String(payment._id), providerOrder,
      });
      assert.equal(confirmed.processed, true);
      const replay = await processVerifiedAuctionPix({
        paymentId: String(payment._id), providerOrder,
      });
      assert.equal(replay.processed, false);
      const finalPayment = await AuctionWinnerPayment.findById(payment._id);
      const finalAttempt = await AuctionWinnerPixAttempt.findOne({ payment: payment._id });
      assert.equal(finalPayment.status, "paid");
      assert.ok(finalPayment.processedAt);
      assert.equal(finalAttempt.state, "provider_confirmed");
      assert.equal(finalAttempt.providerOrderId, providerOrderId);
      assert.equal((await AuctionFulfillment.findById(fulfillment._id)).paymentStatus, "paid");
      assert.equal(await AuctionWinnerPayment.countDocuments({ auction: auctionId }), 1);
      assert.equal(await AuctionWinnerPixAttempt.countDocuments({ auction: auctionId }), 1);
    } finally {
      await mongoose.connection.dropDatabase();
      await mongoose.disconnect();
    }
  });
}
