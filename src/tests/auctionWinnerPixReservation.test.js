import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import AuctionFulfillment from "../models/AuctionFulfillment.js";
import AuctionWinnerPayment from "../models/AuctionWinnerPayment.js";
import { reserveAuctionWinnerPixAttempt } from "../services/AuctionWinnerPixReservationService.js";

const uri = process.env.WALLET_TEST_MONGODB_URI || "";
const safe = /^mongodb:\/\/127\.0\.0\.1:27018\/wallet_test_pix\?/.test(uri) &&
  /(?:\?|&)replicaSet=walletTestRS(?:&|$)/.test(uri) &&
  !/@|authSource=|directConnection=/.test(uri);
const dbName = `auction_pix_reservation_${process.pid}_${Date.now()}`;

async function seed() {
  const auctionId = new mongoose.Types.ObjectId();
  const winnerId = new mongoose.Types.ObjectId();
  const auction = {
    _id: auctionId, winner: winnerId, status: "finished",
    currentPriceCents: 175, endsAt: new Date(Date.now() - 60_000),
  };
  const fulfillment = await AuctionFulfillment.create({
    auction: auctionId, winner: winnerId, product: new mongoose.Types.ObjectId(),
    winningPriceCents: 175, wonAt: auction.endsAt, paymentStatus: "not_started",
  });
  return { auction, winnerId, fulfillment };
}

if (!safe) {
  test("PIX reservation requires isolated local replica set", { skip: "Set WALLET_TEST_MONGODB_URI for walletTestRS:27018" }, () => {});
} else {
  test("parallel requests reserve exactly one logical PIX charge", async () => {
    await mongoose.connect(uri, { dbName, serverSelectionTimeoutMS: 5000 });
    try {
      await AuctionWinnerPayment.init();
      const { auction, winnerId } = await seed();
      const attempts = await Promise.allSettled(Array.from({ length: 8 }, () =>
        reserveAuctionWinnerPixAttempt({ auction, winnerId })));
      const reserved = attempts.filter(x => x.status === "fulfilled" && x.value.reserved);
      assert.equal(reserved.length, 1);
      const failures = attempts.filter(x => x.status === "rejected");
      assert.equal(failures.length, 0, JSON.stringify(failures.map(x => String(x.reason))));
      assert.equal(await AuctionWinnerPayment.countDocuments({ auction: auction._id }), 1);
      const payment = await AuctionWinnerPayment.findOne({ auction: auction._id });
      assert.equal(payment.status, "pending");
      assert.equal(payment.providerOrderId, null);
      const replay = await reserveAuctionWinnerPixAttempt({ auction, winnerId });
      assert.equal(replay.reserved, false);
      assert.equal(replay.reason, "EXISTING_CHARGE");
    } finally {
      await mongoose.connection.dropDatabase();
      await mongoose.disconnect();
    }
  });

  test("non-winner cannot reserve or create PIX attempt", async () => {
    await mongoose.connect(uri, { dbName: dbName + "_wrong_winner", serverSelectionTimeoutMS: 5000 });
    try {
      const { auction } = await seed();
      const result = await reserveAuctionWinnerPixAttempt({
        auction, winnerId: new mongoose.Types.ObjectId(),
      });
      assert.equal(result.reserved, false);
      assert.equal(result.reason, "NOT_WINNER");
      assert.equal(await AuctionWinnerPayment.countDocuments(), 0);
    } finally {
      await mongoose.connection.dropDatabase();
      await mongoose.disconnect();
    }
  });
}
