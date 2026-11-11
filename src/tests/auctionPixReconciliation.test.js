import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import MercadoPagoProvider from "../services/payments/MercadoPagoProvider.js";
import AuctionWinnerPixAttempt from "../models/AuctionWinnerPixAttempt.js";
import AuctionWinnerPayment from "../models/AuctionWinnerPayment.js";
import AuctionFulfillment from "../models/AuctionFulfillment.js";
import { inspectAuctionPixProviderOutcome } from "../services/AuctionPixReconciliationService.js";

const uri = process.env.WALLET_TEST_MONGODB_URI || "";
const safe = /^mongodb:\/\/127\.0\.0\.1:27018\/wallet_test_pix\?/.test(uri) &&
  /(?:\?|&)replicaSet=walletTestRS(?:&|$)/.test(uri) && !/@|authSource=|directConnection=/.test(uri);

if (!safe) {
  test("reconciliation requires local replica set", { skip: "Set WALLET_TEST_MONGODB_URI" }, () => {});
} else {
  test("unknown provider order never triggers provider request or unlocks payment", async () => {
    await mongoose.connect(uri, { dbName: `pix_reconcile_unknown_${process.pid}_${Date.now()}` });
    const original = MercadoPagoProvider.getOrder;
    try {
      const paymentId = new mongoose.Types.ObjectId(), auctionId = new mongoose.Types.ObjectId();
      await AuctionWinnerPixAttempt.create({ payment: paymentId, auction: auctionId,
        idempotencyKey: `pix-${auctionId}`, state: "request_unknown" });
      await AuctionWinnerPayment.create({ _id: paymentId, auction: auctionId,
        fulfillment: new mongoose.Types.ObjectId(), winner: new mongoose.Types.ObjectId(),
        amountCents: 150, status: "pending" });
      MercadoPagoProvider.getOrder = async () => { throw Error("Unexpected lookup"); };
      const result = await inspectAuctionPixProviderOutcome({ paymentId });
      assert.equal(result.reason, "PROVIDER_ORDER_ID_UNKNOWN");
      assert.equal(result.manualReview, true);
      assert.equal((await AuctionWinnerPixAttempt.findOne()).state, "request_unknown");
    } finally {
      MercadoPagoProvider.getOrder = original;
      await mongoose.connection.dropDatabase();
      await mongoose.disconnect();
    }
  });

  test("provider timeout and identity mismatch preserve reconciliation lock", async () => {
    await mongoose.connect(uri, { dbName: `pix_reconcile_fail_${process.pid}_${Date.now()}` });
    const original = MercadoPagoProvider.getOrder;
    try {
      const auctionId = new mongoose.Types.ObjectId(), paymentId = new mongoose.Types.ObjectId();
      const winner = new mongoose.Types.ObjectId(), fulfillmentId = new mongoose.Types.ObjectId();
      await AuctionWinnerPixAttempt.create({ payment: paymentId, auction: auctionId,
        idempotencyKey: `pix-${auctionId}`, state: "reconciliation_required" });
      await AuctionWinnerPayment.create({ _id: paymentId, auction: auctionId,
        fulfillment: fulfillmentId, winner, amountCents: 150, status: "pending",
        providerOrderId: "ORDER-1" });
      await AuctionFulfillment.create({ _id: fulfillmentId, auction: auctionId,
        winner, product: new mongoose.Types.ObjectId(), winningPriceCents: 150,
        wonAt: new Date(), paymentStatus: "pending" });
      MercadoPagoProvider.getOrder = async () => { throw Error("timeout"); };
      assert.equal((await inspectAuctionPixProviderOutcome({ paymentId })).reason, "PROVIDER_UNAVAILABLE");
      MercadoPagoProvider.getOrder = async () => ({ orderId: "ORDER-2",
        externalReference: String(paymentId), raw: { transactions: { payments: [] } } });
      assert.equal((await inspectAuctionPixProviderOutcome({ paymentId })).reason, "PROVIDER_IDENTITY_MISMATCH");
      assert.equal((await AuctionWinnerPixAttempt.findOne()).state, "reconciliation_required");
      assert.equal((await AuctionWinnerPayment.findById(paymentId)).status, "pending");
    } finally {
      MercadoPagoProvider.getOrder = original;
      await mongoose.connection.dropDatabase();
      await mongoose.disconnect();
    }
  });
  test("verified approved PIX is reported read-only without changing financial records", async () => {
    await mongoose.connect(uri, { dbName: `pix_reconcile_approved_${process.pid}_${Date.now()}` });
    const original = MercadoPagoProvider.getOrder;
    try {
      const auctionId = new mongoose.Types.ObjectId(), paymentId = new mongoose.Types.ObjectId();
      const winner = new mongoose.Types.ObjectId(), fulfillmentId = new mongoose.Types.ObjectId();
      await AuctionWinnerPixAttempt.create({ payment: paymentId, auction: auctionId,
        idempotencyKey: `pix-${auctionId}`, state: "reconciliation_required" });
      await AuctionWinnerPayment.create({ _id: paymentId, auction: auctionId,
        fulfillment: fulfillmentId, winner, amountCents: 150, status: "pending",
        providerOrderId: "ORDER-1" });
      await AuctionFulfillment.create({ _id: fulfillmentId, auction: auctionId,
        winner, product: new mongoose.Types.ObjectId(), winningPriceCents: 150,
        wonAt: new Date(), paymentStatus: "pending" });
      MercadoPagoProvider.getOrder = async () => ({
        orderId: "ORDER-1", externalReference: String(paymentId),
        normalizedStatus: "approved", payment: { id: "PIX-1", method: "pix" },
        raw: { total_amount: "1.50", transactions: { payments: [{
          id: "PIX-1", status: "processed", amount: "1.50", payment_method: { id: "pix" },
        }] } },
      });
      const result = await inspectAuctionPixProviderOutcome({ paymentId });
      assert.equal(result.resolved, true);
      assert.equal(result.action, "CONFIRM_USING_EXISTING_VERIFIED_PAYMENT_FLOW");
      assert.equal((await AuctionWinnerPayment.findById(paymentId)).status, "pending");
      assert.equal((await AuctionFulfillment.findById(fulfillmentId)).paymentStatus, "pending");
      assert.equal((await AuctionWinnerPixAttempt.findOne()).state, "reconciliation_required");
    } finally {
      MercadoPagoProvider.getOrder = original;
      await mongoose.connection.dropDatabase();
      await mongoose.disconnect();
    }
  });

}
