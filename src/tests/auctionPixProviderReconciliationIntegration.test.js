import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import MercadoPagoProvider from "../services/payments/MercadoPagoProvider.js";
import AuctionWinnerPayment from "../models/AuctionWinnerPayment.js";
import AuctionWinnerPixAttempt from "../models/AuctionWinnerPixAttempt.js";
import AuctionFulfillment from "../models/AuctionFulfillment.js";
import { reconcileVerifiedAuctionPix } from "../services/AuctionPixReconciliationProcessor.js";

const uri = process.env.WALLET_TEST_MONGODB_URI || "";
const safe = /^mongodb:\/\/127\.0\.0\.1:27018\/wallet_test_pix\?/.test(uri) &&
  /(?:\?|&)replicaSet=walletTestRS(?:&|$)/.test(uri) &&
  !/@|authSource=|directConnection=/.test(uri);
const integration = safe ? test : test.skip;
async function isolated(name, fn) {
  await mongoose.connect(uri, { dbName: `pix_provider_reconcile_${name}_${process.pid}_${Date.now()}`,
    serverSelectionTimeoutMS: 5000 });
  const oldFlag = process.env.AUCTION_PIX_RECONCILIATION_WRITES_ENABLED;
  const originalGetOrder = MercadoPagoProvider.getOrder;
  process.env.AUCTION_PIX_RECONCILIATION_WRITES_ENABLED = "true";
  try { await fn(); }
  finally {
    MercadoPagoProvider.getOrder = originalGetOrder;
    if (oldFlag === undefined) delete process.env.AUCTION_PIX_RECONCILIATION_WRITES_ENABLED;
    else process.env.AUCTION_PIX_RECONCILIATION_WRITES_ENABLED = oldFlag;
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
}
async function fixture() {
  const auction = new mongoose.Types.ObjectId(), winner = new mongoose.Types.ObjectId();
  const fulfillment = await AuctionFulfillment.create({
    auction, winner, product: new mongoose.Types.ObjectId(),
    winningPriceCents: 525, wonAt: new Date(), paymentStatus: "pending",
  });
  const payment = await AuctionWinnerPayment.create({
    auction, fulfillment: fulfillment._id, winner, amountCents: 525,
    status: "pending", providerOrderId: `ORDER-${auction}`,
  });
  await AuctionWinnerPixAttempt.create({
    auction, payment: payment._id, idempotencyKey: `auction-winner-pix-${auction}`,
    state: "reconciliation_required",
  });
  const response = {
    orderId: `ORDER-${auction}`, externalReference: String(payment._id),
    normalizedStatus: "approved", payment: { id: `PIX-${auction}`, method: "pix" },
    raw: { total_amount: "5.25", transactions: { payments: [{
      id: `PIX-${auction}`, amount: "5.25", status: "processed",
      payment_method: { id: "pix" },
    }] } },
  };
  return { payment, fulfillment, response };
}
async function assertPending(payment, fulfillment) {
  assert.equal((await AuctionWinnerPayment.findById(payment._id)).status, "pending");
  assert.equal((await AuctionFulfillment.findById(fulfillment._id)).paymentStatus, "pending");
  assert.equal((await AuctionWinnerPixAttempt.findOne({ payment: payment._id })).state, "reconciliation_required");
}
integration("provider lookup confirms ambiguous PIX atomically and replay is harmless", async () => {
  await isolated("approved", async () => {
    const { payment, fulfillment, response } = await fixture();
    const calls = [];
    MercadoPagoProvider.getOrder = async (id) => { calls.push(id); return response; };
    const result = await reconcileVerifiedAuctionPix({ paymentId: String(payment._id) });
    assert.equal(result.processed, true);
    assert.deepEqual(calls, [payment.providerOrderId]);
    assert.equal((await AuctionWinnerPayment.findById(payment._id)).status, "paid");
    assert.equal((await AuctionFulfillment.findById(fulfillment._id)).paymentStatus, "paid");
    const attempt = await AuctionWinnerPixAttempt.findOne({ payment: payment._id });
    assert.equal(attempt.state, "provider_confirmed");
    assert.equal(attempt.providerOrderId, response.orderId);
    assert.equal((await reconcileVerifiedAuctionPix({ paymentId: String(payment._id) })).processed, false);
    assert.equal(calls.length, 1);
  });
});
integration("provider identity mismatch cannot reconcile PIX", async () => {
  await isolated("mismatch", async () => {
    const { payment, fulfillment, response } = await fixture();
    MercadoPagoProvider.getOrder = async () => ({ ...response, externalReference: String(new mongoose.Types.ObjectId()) });
    const result = await reconcileVerifiedAuctionPix({ paymentId: String(payment._id) });
    assert.equal(result.processed, false);
    await assertPending(payment, fulfillment);
  });
});
integration("provider unavailable leaves ambiguous PIX unchanged", async () => {
  await isolated("unavailable", async () => {
    const { payment, fulfillment } = await fixture();
    MercadoPagoProvider.getOrder = async () => { throw new Error("Simulated provider timeout"); };
    const result = await reconcileVerifiedAuctionPix({ paymentId: String(payment._id) });
    assert.deepEqual(result, { processed: false, reason: "PROVIDER_UNAVAILABLE" });
    await assertPending(payment, fulfillment);
  });
});
