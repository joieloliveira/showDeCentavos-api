import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import auctionRoutes from "../routes/auctionRoutes.js";
import Auction from "../models/Auction.js";
import Bid from "../models/Bid.js";
import User from "../models/User.js";
import WalletTransaction from "../models/WalletTransaction.js";

const uri = process.env.WALLET_TEST_MONGODB_URI || "";
const safe = /^mongodb:\/\/127\.0\.0\.1:27018\/wallet_test_pix\?/.test(uri) && /(?:\?|&)replicaSet=walletTestRS(?:&|$)/.test(uri);
const integration = safe ? test : test.skip;
let server, base, userId, auctionId, originalSecret, originalFlag;
const key = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const token = () => jwt.sign({ id: String(userId), role: "customer" }, process.env.JWT_SECRET);
async function bid(idempotencyKey, auth = token()) {
  const response = await fetch(`${base}/api/auctions/${auctionId}/bids`, {
    method: "POST", headers: { "content-type": "application/json", ...(auth ? { authorization: `Bearer ${auth}` } : {}) },
    body: JSON.stringify({ idempotencyKey })
  });
  return { status: response.status, body: await response.json() };
}
if (safe) {
  before(async () => {
    originalSecret = process.env.JWT_SECRET;
    originalFlag = process.env.AUCTION_BIDDING_ENABLED;
    process.env.JWT_SECRET = "isolated-auction-bid-integration-secret";
    process.env.AUCTION_BIDDING_ENABLED = "true";
    await mongoose.connect(uri, { dbName: `auction_bid_test_${process.pid}_${Date.now()}`, serverSelectionTimeoutMS: 5000 });
    await Promise.all([Bid.createIndexes(), WalletTransaction.createIndexes()]);
    const user = await User.create({ name: "Bid Test", email: `bid-${Date.now()}@example.test`, wallet: { balanceCents: 100 }, isActive: true });
    userId = user._id;
    const product = new mongoose.Types.ObjectId();
    const auction = await Auction.create({
      product, status: "active", bidCostCents: 50, bidIncrementCents: 1,
      currentPriceCents: 0, startPriceCents: 0, bidCount: 0,
      startsAt: new Date(Date.now() - 60000), endsAt: null
    });
    auctionId = auction._id;
    const app = express();
    app.use(express.json());
    app.use("/api/auctions", auctionRoutes);
    server = app.listen(0, "127.0.0.1");
    await new Promise(resolve => server.once("listening", resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
    if (mongoose.connection.readyState === 1) await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    if (originalSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = originalSecret;
    if (originalFlag === undefined) delete process.env.AUCTION_BIDDING_ENABLED; else process.env.AUCTION_BIDDING_ENABLED = originalFlag;
  });
}
integration("feature flag rejects bids without changing wallet", async () => {
  process.env.AUCTION_BIDDING_ENABLED = "false";
  try {
    assert.equal((await bid(key(1))).status, 503);
    assert.equal((await User.findById(userId)).wallet.balanceCents, 100);
    assert.equal(await Bid.countDocuments(), 0);
  } finally { process.env.AUCTION_BIDDING_ENABLED = "true"; }
});
integration("requires valid authentication and UUID", async () => {
  assert.equal((await bid(key(2), null)).status, 401);
  assert.equal((await bid("invalid")).status, 400);
  assert.equal(await Bid.countDocuments(), 0);
});
integration("concurrent distinct bids never overspend balance", async () => {
  const results = await Promise.all(Array.from({ length: 5 }, (_, i) => bid(key(i + 10))));
  const accepted = results.filter(r => r.status === 201);
  assert.ok(accepted.length >= 1 && accepted.length <= 2, JSON.stringify(results.map(r => r.status)));
  const user = await User.findById(userId);
  const auction = await Auction.findById(auctionId);
  const bids = await Bid.find().lean();
  const ledger = await WalletTransaction.find({ type: "bid" }).lean();
  assert.equal(bids.length, accepted.length);
  assert.equal(ledger.length, accepted.length);
  assert.equal(auction.bidCount, accepted.length);
  assert.equal(auction.currentPriceCents, accepted.length);
  assert.equal(user.wallet.balanceCents, 100 - accepted.length * 50);
  assert.deepEqual(new Set(ledger.map(l => String(l.bid))).size, accepted.length);
});
integration("idempotent replay does not charge twice", async () => {
  const existing = await Bid.findOne().lean();
  const before = await User.findById(userId);
  const result = await bid(existing.idempotencyKey);
  assert.equal(result.status, 200);
  assert.equal(result.body.duplicate, true);
  assert.equal((await User.findById(userId)).wallet.balanceCents, before.wallet.balanceCents);
  assert.equal(await WalletTransaction.countDocuments({ type: "bid" }), await Bid.countDocuments());
});
integration("insufficient balance rejects without ledger write", async () => {
  await User.updateOne({ _id: userId }, { $set: { "wallet.balanceCents": 0 } });
  const before = await Bid.countDocuments();
  assert.equal((await bid(key(99))).status, 409);
  assert.equal(await Bid.countDocuments(), before);
  assert.equal(await WalletTransaction.countDocuments({ type: "bid" }), before);
});
