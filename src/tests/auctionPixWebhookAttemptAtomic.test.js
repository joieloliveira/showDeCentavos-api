import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import AuctionWinnerPayment from "../models/AuctionWinnerPayment.js";
import AuctionWinnerPixAttempt from "../models/AuctionWinnerPixAttempt.js";
import AuctionFulfillment from "../models/AuctionFulfillment.js";
import { processVerifiedAuctionPix } from "../services/AuctionWinnerPaymentService.js";

const uri = process.env.WALLET_TEST_MONGODB_URI || "";
const safe = /^mongodb:\/\/127\.0\.0\.1:27018\/wallet_test_pix\?/.test(uri) &&
  /(?:\?|&)replicaSet=walletTestRS(?:&|$)/.test(uri) &&
  !/@|authSource=|directConnection=/.test(uri);
const integration = safe ? test : test.skip;
async function fixture(state = "reserved", attemptOrderId = null) {
  const auction = new mongoose.Types.ObjectId(), winner = new mongoose.Types.ObjectId();
  const fulfillment = await AuctionFulfillment.create({
    auction, winner, product: new mongoose.Types.ObjectId(),
    winningPriceCents: 275, wonAt: new Date(), paymentStatus: "pending",
  });
  const payment = await AuctionWinnerPayment.create({
    auction, fulfillment: fulfillment._id, winner, amountCents: 275,
    status: "pending", providerOrderId: "ORDER-275",
  });
  await AuctionWinnerPixAttempt.create({
    auction, payment: payment._id, idempotencyKey: `auction-winner-pix-${auction}`,
    state, providerOrderId: attemptOrderId,
  });
  const providerOrder = {
    orderId: "ORDER-275", externalReference: String(payment._id),
    normalizedStatus: "approved", totalAmountCents: 275,
    payment: { id: "PIX-275", paymentMethodId: "pix" },
    transactions: [{ id: "PIX-275", status: "approved", paymentMethodId: "pix", amountCents: 275 }],
  };
  return { payment, fulfillment, providerOrder };
}
async function isolated(name, callback) {
  await mongoose.connect(uri, { dbName: `pix_webhook_attempt_${name}_${process.pid}_${Date.now()}`,
    serverSelectionTimeoutMS: 5000 });
  try { await callback(); }
  finally { await mongoose.connection.dropDatabase(); await mongoose.disconnect(); }
}
integration("ordinary webhook atomically confirms reserved attempt and payment", async () => {
  await isolated("success", async () => {
    const { payment, fulfillment, providerOrder } = await fixture();
    const result = await processVerifiedAuctionPix({ paymentId: payment._id, providerOrder });
    assert.equal(result.processed, true);
    assert.equal((await AuctionWinnerPayment.findById(payment._id)).status, "paid");
    assert.equal((await AuctionFulfillment.findById(fulfillment._id)).paymentStatus, "paid");
    const attempt = await AuctionWinnerPixAttempt.findOne({ payment: payment._id });
    assert.equal(attempt.state, "provider_confirmed");
    assert.equal(attempt.providerOrderId, "ORDER-275");
    assert.equal((await processVerifiedAuctionPix({ paymentId: payment._id, providerOrder })).processed, false);
  });
});
integration("ordinary webhook rejects mismatched attempt identity without writes", async () => {
  await isolated("mismatch", async () => {
    const { payment, fulfillment, providerOrder } = await fixture("reserved", "OTHER-ORDER");
    const result = await processVerifiedAuctionPix({ paymentId: payment._id, providerOrder });
    assert.equal(result.processed, false);
    assert.equal(result.reason, "RECONCILIATION_REQUIRED");
    assert.equal((await AuctionWinnerPayment.findById(payment._id)).status, "pending");
    assert.equal((await AuctionFulfillment.findById(fulfillment._id)).paymentStatus, "pending");
    assert.equal((await AuctionWinnerPixAttempt.findOne({ payment: payment._id })).state, "reserved");
  });
});
integration("ordinary webhook cannot bypass reconciliation-required attempt", async () => {
  await isolated("unknown", async () => {
    const { payment, fulfillment, providerOrder } = await fixture("reconciliation_required");
    const result = await processVerifiedAuctionPix({ paymentId: payment._id, providerOrder });
    assert.equal(result.processed, false);
    assert.equal(result.reason, "RECONCILIATION_REQUIRED");
    assert.equal((await AuctionWinnerPayment.findById(payment._id)).status, "pending");
    assert.equal((await AuctionFulfillment.findById(fulfillment._id)).paymentStatus, "pending");
  });
});

integration("concurrent webhook confirmations commit exactly one durable attempt", async () => {
  await isolated("concurrent", async () => {
    const { payment, fulfillment, providerOrder } = await fixture();
    const results = await Promise.allSettled(Array.from({ length: 6 }, () =>
      processVerifiedAuctionPix({ paymentId: payment._id, providerOrder })));
    const successful = results.filter(result => result.status === "fulfilled" && result.value.processed);
    assert.equal(successful.length, 1, JSON.stringify(results.map(result =>
      result.status === "fulfilled" ? result.value : String(result.reason))));
    assert.equal((await AuctionWinnerPayment.findById(payment._id)).status, "paid");
    assert.equal((await AuctionFulfillment.findById(fulfillment._id)).paymentStatus, "paid");
    const attempts = await AuctionWinnerPixAttempt.find({ payment: payment._id }).lean();
    assert.equal(attempts.length, 1);
    assert.equal(attempts[0].state, "provider_confirmed");
    assert.equal(attempts[0].providerOrderId, providerOrder.orderId);
    assert.equal(await AuctionWinnerPayment.countDocuments({ auction: payment.auction }), 1);
  });
});
integration("failed attempt finalization rolls back payment and fulfillment together", async () => {
  await isolated("rollback", async () => {
    const { payment, fulfillment, providerOrder } = await fixture();
    const originalUpdate = AuctionWinnerPixAttempt.updateOne;
    try {
      AuctionWinnerPixAttempt.updateOne = async () => {
        throw new Error("Simulated durable attempt write failure");
      };
      await assert.rejects(
        processVerifiedAuctionPix({ paymentId: payment._id, providerOrder }),
        /Simulated durable attempt write failure/
      );
    } finally {
      AuctionWinnerPixAttempt.updateOne = originalUpdate;
    }
    const storedPayment = await AuctionWinnerPayment.findById(payment._id).lean();
    const storedFulfillment = await AuctionFulfillment.findById(fulfillment._id).lean();
    const storedAttempt = await AuctionWinnerPixAttempt.findOne({ payment: payment._id }).lean();
    assert.equal(storedPayment.status, "pending");
    assert.equal(storedPayment.processedAt, null);
    assert.equal(storedPayment.providerPaymentId, null);
    assert.equal(storedFulfillment.paymentStatus, "pending");
    assert.equal(storedAttempt.state, "reserved");
    assert.equal(storedAttempt.providerOrderId, null);
  });
});
