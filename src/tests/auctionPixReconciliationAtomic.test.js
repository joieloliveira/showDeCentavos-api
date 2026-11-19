import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import AuctionWinnerPayment from "../models/AuctionWinnerPayment.js";
import AuctionWinnerPixAttempt from "../models/AuctionWinnerPixAttempt.js";
import AuctionFulfillment from "../models/AuctionFulfillment.js";
import { processVerifiedAuctionPix } from "../services/AuctionWinnerPaymentService.js";

const uri = process.env.WALLET_TEST_MONGODB_URI || "";
const safe = /^mongodb:\/\/127\.0\.0\.1:27018\/wallet_test_pix\?/.test(uri) &&
  /(?:\?|&)replicaSet=walletTestRS(?:&|$)/.test(uri) && !/@|authSource=|directConnection=/.test(uri);

if (!safe) {
  test("atomic reconciliation requires local replica set", { skip: "Set WALLET_TEST_MONGODB_URI" }, () => {});
} else {
  test("reconciliation confirms payment, fulfillment and attempt atomically; replay cannot reconfirm", async () => {
    await mongoose.connect(uri, { dbName: `pix_reconcile_atomic_${process.pid}_${Date.now()}` });
    try {
      const auction = new mongoose.Types.ObjectId(), winner = new mongoose.Types.ObjectId();
      const fulfillmentId = new mongoose.Types.ObjectId(), paymentId = new mongoose.Types.ObjectId();
      await AuctionFulfillment.create({ _id: fulfillmentId, auction, winner,
        product: new mongoose.Types.ObjectId(), winningPriceCents: 150,
        wonAt: new Date(), paymentStatus: "pending" });
      await AuctionWinnerPayment.create({ _id: paymentId, auction, fulfillment: fulfillmentId,
        winner, amountCents: 150, status: "pending", providerOrderId: "ORDER-1" });
      await AuctionWinnerPixAttempt.create({ auction, payment: paymentId,
        idempotencyKey: `auction-winner-pix-${auction}`, state: "reconciliation_required" });
      const providerOrder = {
        orderId: "ORDER-1", externalReference: String(paymentId),
        normalizedStatus: "approved", totalAmountCents: 150,
        payment: { id: "PIX-1", paymentMethodId: "pix" },
        transactions: [{ id: "PIX-1", paymentMethodId: "pix", status: "approved", amountCents: 150 }],
      };
      const first = await processVerifiedAuctionPix({ paymentId, providerOrder, reconcileAttempt: true });
      assert.equal(first.processed, true);
      assert.equal((await AuctionWinnerPayment.findById(paymentId)).status, "paid");
      assert.equal((await AuctionFulfillment.findById(fulfillmentId)).paymentStatus, "paid");
      const attempt = await AuctionWinnerPixAttempt.findOne({ payment: paymentId });
      assert.equal(attempt.state, "provider_confirmed");
      assert.equal(attempt.providerOrderId, "ORDER-1");
      const replay = await processVerifiedAuctionPix({ paymentId, providerOrder, reconcileAttempt: true });
      assert.equal(replay.processed, false);
      assert.equal((await AuctionWinnerPixAttempt.findOne({ payment: paymentId })).state, "provider_confirmed");
    } finally {
      await mongoose.connection.dropDatabase();
      await mongoose.disconnect();
    }
  });
  test("missing reconciliation attempt prevents any financial state transition", async () => {
    await mongoose.connect(uri, { dbName: `pix_reconcile_no_attempt_${process.pid}_${Date.now()}` });
    try {
      const auction = new mongoose.Types.ObjectId(), winner = new mongoose.Types.ObjectId();
      const fulfillmentId = new mongoose.Types.ObjectId(), paymentId = new mongoose.Types.ObjectId();
      await AuctionFulfillment.create({ _id: fulfillmentId, auction, winner,
        product: new mongoose.Types.ObjectId(), winningPriceCents: 150,
        wonAt: new Date(), paymentStatus: "pending" });
      await AuctionWinnerPayment.create({ _id: paymentId, auction, fulfillment: fulfillmentId,
        winner, amountCents: 150, status: "pending", providerOrderId: "ORDER-1" });
      const providerOrder = {
        orderId: "ORDER-1", externalReference: String(paymentId),
        normalizedStatus: "approved", totalAmountCents: 150,
        payment: { id: "PIX-1", paymentMethodId: "pix" },
        transactions: [{ id: "PIX-1", paymentMethodId: "pix", status: "approved", amountCents: 150 }],
      };
      const result = await processVerifiedAuctionPix({ paymentId, providerOrder, reconcileAttempt: true });
      assert.equal(result.processed, false);
      assert.equal(result.reason, "RECONCILIATION_ATTEMPT_MISMATCH");
      assert.equal((await AuctionWinnerPayment.findById(paymentId)).status, "pending");
      assert.equal((await AuctionFulfillment.findById(fulfillmentId)).paymentStatus, "pending");
    } finally {
      await mongoose.connection.dropDatabase();
      await mongoose.disconnect();
    }
  });
}
