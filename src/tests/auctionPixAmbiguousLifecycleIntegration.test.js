import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import AuctionWinnerPayment from "../models/AuctionWinnerPayment.js";
import AuctionWinnerPixAttempt from "../models/AuctionWinnerPixAttempt.js";
import AuctionFulfillment from "../models/AuctionFulfillment.js";
import { reserveAuctionWinnerPixAttempt } from "../services/AuctionWinnerPixReservationService.js";
import { markAuctionPixRequestUnknown, requireAuctionPixReconciliation } from "../services/AuctionWinnerPixAttemptService.js";
import { processVerifiedAuctionPix } from "../services/AuctionWinnerPaymentService.js";

const uri = process.env.WALLET_TEST_MONGODB_URI || "";
const safe = /^mongodb:\/\/127\.0\.0\.1:27018\/wallet_test_pix\?/.test(uri) &&
  /(?:\?|&)replicaSet=walletTestRS(?:&|$)/.test(uri) &&
  !/@|authSource=|directConnection=/.test(uri);
const integration = safe ? test : test.skip;

async function runIsolated(name, fn) {
  await mongoose.connect(uri, {
    dbName: `pix_ambiguous_lifecycle_${name}_${process.pid}_${Date.now()}`,
    serverSelectionTimeoutMS: 5000,
  });
  try { await fn(); }
  finally { await mongoose.connection.dropDatabase(); await mongoose.disconnect(); }
}

async function fixture() {
  const auctionId = new mongoose.Types.ObjectId();
  const winner = new mongoose.Types.ObjectId();
  const endsAt = new Date(Date.now() - 60_000);
  const auction = {
    _id: auctionId, winner, status: "finished",
    currentPriceCents: 425, endsAt,
  };
  const fulfillment = await AuctionFulfillment.create({
    auction: auctionId, winner, product: new mongoose.Types.ObjectId(),
    winningPriceCents: 425, wonAt: endsAt, paymentStatus: "not_started",
  });
  const reservation = await reserveAuctionWinnerPixAttempt({ auction, winnerId: winner });
  assert.equal(reservation.reserved, true);
  const providerOrderId = `ORDER-${auctionId}`;
  assert.equal((await AuctionWinnerPayment.updateOne({
    _id: reservation.paymentId, providerOrderId: null,
  }, { $set: { providerOrderId } })).modifiedCount, 1);
  const providerOrder = {
    orderId: providerOrderId, externalReference: reservation.paymentId,
    normalizedStatus: "approved", totalAmountCents: 425,
    payment: { id: `PIX-${auctionId}`, paymentMethodId: "pix" },
    transactions: [{
      id: `PIX-${auctionId}`, status: "approved",
      paymentMethodId: "pix", amountCents: 425,
    }],
  };
  return { auction, fulfillment, reservation, providerOrder };
}

integration("unknown PIX request requires reconciliation; verified reconciliation confirms once", async () => {
  await runIsolated("approved", async () => {
    const { auction, fulfillment, reservation, providerOrder } = await fixture();
    const paymentId = reservation.paymentId;
    const unknown = await markAuctionPixRequestUnknown({ paymentId, reason: "TIMEOUT" });
    assert.equal(unknown.updated, true);
    assert.equal(unknown.state, "request_unknown");
    assert.equal(unknown.idempotencyKey, reservation.idempotencyKey);
    const blocked = await processVerifiedAuctionPix({ paymentId, providerOrder });
    assert.deepEqual(blocked, { processed: false, reason: "RECONCILIATION_REQUIRED" });
    const required = await requireAuctionPixReconciliation({ paymentId });
    assert.equal(required.updated, true);
    assert.equal(required.state, "reconciliation_required");
    assert.equal((await markAuctionPixRequestUnknown({ paymentId })).updated, false);
    assert.equal((await reserveAuctionWinnerPixAttempt({
      auction, winnerId: auction.winner,
    })).reserved, false);
    const confirmed = await processVerifiedAuctionPix({
      paymentId, providerOrder, reconcileAttempt: true,
    });
    assert.equal(confirmed.processed, true);
    assert.equal((await AuctionWinnerPayment.findById(paymentId)).status, "paid");
    assert.equal((await AuctionFulfillment.findById(fulfillment._id)).paymentStatus, "paid");
    const attempt = await AuctionWinnerPixAttempt.findOne({ payment: paymentId });
    assert.equal(attempt.state, "provider_confirmed");
    assert.equal(attempt.idempotencyKey, reservation.idempotencyKey);
    assert.equal(attempt.providerOrderId, providerOrder.orderId);
    assert.equal((await processVerifiedAuctionPix({
      paymentId, providerOrder, reconcileAttempt: true,
    })).processed, false);
    assert.equal(await AuctionWinnerPayment.countDocuments({ auction: auction._id }), 1);
    assert.equal(await AuctionWinnerPixAttempt.countDocuments({ auction: auction._id }), 1);
  });
});

integration("mismatched reconciliation order preserves all pending states", async () => {
  await runIsolated("mismatch", async () => {
    const { fulfillment, reservation, providerOrder } = await fixture();
    const paymentId = reservation.paymentId;
    assert.equal((await markAuctionPixRequestUnknown({ paymentId })).updated, true);
    assert.equal((await requireAuctionPixReconciliation({ paymentId })).updated, true);
    const attempt = await AuctionWinnerPixAttempt.findOne({ payment: paymentId });
    attempt.providerOrderId = "OTHER-ORDER";
    await attempt.save();
    const result = await processVerifiedAuctionPix({
      paymentId, providerOrder, reconcileAttempt: true,
    });
    assert.deepEqual(result, { processed: false, reason: "RECONCILIATION_ATTEMPT_MISMATCH" });
    const payment = await AuctionWinnerPayment.findById(paymentId);
    assert.equal(payment.status, "pending");
    assert.equal(payment.processedAt, null);
    assert.equal((await AuctionFulfillment.findById(fulfillment._id)).paymentStatus, "pending");
    const storedAttempt = await AuctionWinnerPixAttempt.findOne({ payment: paymentId });
    assert.equal(storedAttempt.state, "reconciliation_required");
    assert.equal(storedAttempt.providerOrderId, "OTHER-ORDER");
    assert.equal(storedAttempt.idempotencyKey, reservation.idempotencyKey);
  });
});
