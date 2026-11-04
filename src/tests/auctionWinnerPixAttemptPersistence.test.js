import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import AuctionFulfillment from "../models/AuctionFulfillment.js";
import AuctionWinnerPayment from "../models/AuctionWinnerPayment.js";
import AuctionWinnerPixAttempt from "../models/AuctionWinnerPixAttempt.js";
import { reserveAuctionWinnerPixAttempt } from "../services/AuctionWinnerPixReservationService.js";
import { markAuctionPixRequestUnknown, requireAuctionPixReconciliation } from "../services/AuctionWinnerPixAttemptService.js";

const uri = process.env.WALLET_TEST_MONGODB_URI || "";
const safe = /^mongodb:\/\/127\.0\.0\.1:27018\/wallet_test_pix\?/.test(uri) &&
  /(?:\?|&)replicaSet=walletTestRS(?:&|$)/.test(uri) &&
  !/@|authSource=|directConnection=/.test(uri);
if (!safe) {
  test("durable PIX attempts require isolated replica set", { skip: "Configure WALLET_TEST_MONGODB_URI for local walletTestRS" }, () => {});
} else {
  test("reservation and immutable idempotency attempt commit together", async () => {
    await mongoose.connect(uri, { dbName: `pix_attempt_atomic_${process.pid}_${Date.now()}` });
    try {
      await AuctionWinnerPayment.init();
      await AuctionWinnerPixAttempt.init();
      const auctionId = new mongoose.Types.ObjectId();
      const winnerId = new mongoose.Types.ObjectId();
      const auction = { _id: auctionId, winner: winnerId, status: "finished",
        currentPriceCents: 350, endsAt: new Date(Date.now() - 60000) };
      await AuctionFulfillment.create({
        auction: auctionId, winner: winnerId, product: new mongoose.Types.ObjectId(),
        winningPriceCents: 350, wonAt: auction.endsAt, paymentStatus: "not_started",
      });
      const results = await Promise.allSettled(Array.from({ length: 6 }, () =>
        reserveAuctionWinnerPixAttempt({ auction, winnerId })));
      assert.equal(results.filter(x => x.status === "rejected").length, 0);
      assert.equal(results.filter(x => x.status === "fulfilled" && x.value.reserved).length, 1);
      assert.equal(await AuctionWinnerPayment.countDocuments(), 1);
      assert.equal(await AuctionWinnerPixAttempt.countDocuments(), 1);
      const payment = await AuctionWinnerPayment.findOne();
      const attempt = await AuctionWinnerPixAttempt.findOne();
      assert.equal(String(attempt.payment), String(payment._id));
      assert.equal(attempt.idempotencyKey, `auction-winner-pix-${auctionId}`);
      assert.equal(attempt.state, "reserved");
      assert.equal((await AuctionFulfillment.findOne({ auction: auctionId })).paymentStatus, "pending");
      const replay = await reserveAuctionWinnerPixAttempt({ auction, winnerId });
      assert.equal(replay.reserved, false);
      assert.equal(await AuctionWinnerPixAttempt.countDocuments(), 1);
    } finally {
      await mongoose.connection.dropDatabase();
      await mongoose.disconnect();
    }
  });
  test("unknown provider outcome becomes reconciliation-required without changing key", async () => {
    await mongoose.connect(uri, { dbName: `pix_attempt_unknown_${process.pid}_${Date.now()}` });
    try {
      const paymentId = new mongoose.Types.ObjectId();
      const key = `auction-winner-pix-${new mongoose.Types.ObjectId()}`;
      await AuctionWinnerPixAttempt.create({
        payment: paymentId, auction: new mongoose.Types.ObjectId(),
        idempotencyKey: key, state: "reserved",
      });
      const first = await markAuctionPixRequestUnknown({ paymentId });
      assert.equal(first.updated, true);
      assert.equal(first.idempotencyKey, key);
      const second = await markAuctionPixRequestUnknown({ paymentId });
      assert.equal(second.updated, false);
      const recon = await requireAuctionPixReconciliation({ paymentId });
      assert.equal(recon.updated, true);
      assert.equal(recon.state, "reconciliation_required");
      const duplicate = await requireAuctionPixReconciliation({ paymentId });
      assert.equal(duplicate.updated, false);
      const stored = await AuctionWinnerPixAttempt.findOne({ payment: paymentId });
      assert.equal(stored.idempotencyKey, key);
      assert.equal(stored.state, "reconciliation_required");
    } finally {
      await mongoose.connection.dropDatabase();
      await mongoose.disconnect();
    }
  });
}
