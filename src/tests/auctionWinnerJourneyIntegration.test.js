import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import express from "express";
import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";
import Auction from "../models/Auction.js";
import User from "../models/User.js";
import AuctionFulfillment from "../models/AuctionFulfillment.js";
import auctionRoutes from "../routes/auctionRoutes.js";
import { processAuctionSchedules } from "../services/AuctionSchedulerService.js";

const uri = process.env.WALLET_TEST_MONGODB_URI || "";
function safeTestUri(value) {
  try {
    const u = new URL(value);
    return u.protocol === "mongodb:" && u.hostname === "127.0.0.1" &&
      u.port === "27018" && u.pathname === "/wallet_test_pix" &&
      u.searchParams.get("replicaSet") === "walletTestRS" &&
      !u.username && !u.password;
  } catch { return false; }
}

test("isolated winner journey: scheduler finishes auction, winner sees read-only order, stranger sees none", {
  skip: !safeTestUri(uri) && "Requires isolated local MongoDB replica set",
  timeout: 30000,
}, async () => {
  const previousSecret = process.env.JWT_SECRET;
  const previousBidding = process.env.AUCTION_BIDDING_ENABLED;
  let server;
  let connected = false;
  process.env.JWT_SECRET = "isolated-winner-journey-secret";
  process.env.AUCTION_BIDDING_ENABLED = "false";
  try {
    await mongoose.connect(uri, {
      dbName: `auction_winner_journey_${process.pid}_${Date.now()}`,
      serverSelectionTimeoutMS: 5000,
    });
    connected = true;
    const winner = await User.create({
      name: "Winner Journey", email: `winner-${randomUUID()}@example.invalid`,
      isActive: true, wallet: { balanceCents: 2400 },
    });
    const stranger = await User.create({
      name: "Stranger Journey", email: `stranger-${randomUUID()}@example.invalid`,
      isActive: true,
    });
    // Seed a previously recorded bid result, without placing a bid or debiting any wallet.
    const past = new Date(Date.now() - 60000);
    const auction = await Auction.create({
      product: new mongoose.Types.ObjectId(), status: "scheduled",
      waitingStartedAt: past, startsAt: past, endsAt: new Date(Date.now() - 1000),
      bidCostCents: 50, currentPriceCents: 101, bidCount: 1, lastBidder: winner._id,
    });
    await processAuctionSchedules();
    assert.equal((await Auction.findById(auction._id)).status, "finished");
    assert.equal(String((await Auction.findById(auction._id)).winner), String(winner._id));
    await processAuctionSchedules();
    assert.equal(await Auction.countDocuments({ _id: auction._id, status: "finished" }), 1);

    const app = express();
    app.use(express.json());
    app.use("/api/auctions", auctionRoutes);
    server = app.listen(0, "127.0.0.1");
    await new Promise(resolve => server.once("listening", resolve));
    const base = `http://127.0.0.1:${server.address().port}/api/auctions/my/wins`;
    const read = async id => {
      const headers = id ? { authorization: `Bearer ${jwt.sign({ id: String(id) }, process.env.JWT_SECRET)}` } : {};
      const res = await fetch(base, { headers });
      return { status: res.status, cache: res.headers.get("cache-control"), body: await res.json() };
    };
    assert.equal((await read(null)).status, 401);
    const mine = await read(winner._id);
    assert.equal(mine.status, 200);
    assert.match(mine.cache || "", /no-store/);
    assert.equal(mine.body.total, 1);
    const item = mine.body.items[0];
    assert.equal(item.auctionId, String(auction._id));
    assert.equal(item.finalPriceCents, 101);
    assert.equal(item.paymentStatus, "not_started");
    assert.equal(item.deliveryStatus, "not_started");
    assert.equal(item.fulfillmentAvailable, false);
    assert.equal(item.paymentWindowStatus, "awaiting_payment");
    assert.equal(item.shippingAddress, null);
    assert.equal(new Date(item.paymentDeadline).getTime(), new Date(auction.endsAt).getTime() + 48 * 3600000);
    assert.equal((await read(stranger._id)).body.total, 0);
    assert.equal(await AuctionFulfillment.countDocuments({ auction: auction._id }), 0);
    assert.equal((await User.findById(winner._id)).wallet.balanceCents, 2400);
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    if (connected) {
      await mongoose.connection.dropDatabase();
      await mongoose.disconnect();
    }
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
    if (previousBidding === undefined) delete process.env.AUCTION_BIDDING_ENABLED;
    else process.env.AUCTION_BIDDING_ENABLED = previousBidding;
  }
});
