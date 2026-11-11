import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import auctionRoutes from "../routes/auctionRoutes.js";
import Auction from "../models/Auction.js";
import Bid from "../models/Bid.js";
import User from "../models/User.js";

const uri = process.env.WALLET_TEST_MONGODB_URI || "";
const safe = /^mongodb:\/\/127\.0\.0\.1:27018\/wallet_test_pix\?/.test(uri) &&
  /(?:\?|&)replicaSet=walletTestRS(?:&|$)/.test(uri);
const integration = safe ? test : test.skip;
let server, base, user, other, oldSecret;
const token = id => jwt.sign({ id: String(id), role: "customer" }, process.env.JWT_SECRET);
const request = async (page, auth) => {
  const response = await fetch(`${base}/api/auctions/my/participations?page=${page}`, {
    headers: auth ? { authorization: `Bearer ${auth}` } : {}
  });
  return { response, body: await response.json() };
};

if (safe) {
  before(async () => {
    oldSecret = process.env.JWT_SECRET;
    process.env.JWT_SECRET = "isolated-auction-participations-secret";
    await mongoose.connect(uri, {
      dbName: `auction_participations_test_${process.pid}_${Date.now()}`,
      serverSelectionTimeoutMS: 5000
    });
    user = await User.create({ name: "History User", email: `history-${Date.now()}@example.test`, isActive: true });
    other = await User.create({ name: "Other History User", email: `history-other-${Date.now()}@example.test`, isActive: true });
    const auctions = await Auction.insertMany(Array.from({ length: 23 }, () => ({
      product: new mongoose.Types.ObjectId(), status: "scheduled", bidCostCents: 50
    })));
    const now = Date.now();
    await Bid.insertMany(auctions.flatMap((auction, index) => {
      const createdAt = new Date(now - index * 60000);
      return Array.from({ length: index === 0 ? 3 : 1 }, (_, bidIndex) => ({
        auction: auction._id, user: user._id,
        idempotencyKey: `history-${index}-${bidIndex}`,
        bidCostCents: 50, priceBeforeCents: bidIndex, priceAfterCents: bidIndex + 1,
        balanceAfterCents: 100, expiresAt: createdAt, createdAt, updatedAt: createdAt
      }));
    }));
    await Bid.create({
      auction: auctions[0]._id, user: other._id, idempotencyKey: "other-user-key",
      bidCostCents: 100, priceBeforeCents: 0, priceAfterCents: 1,
      balanceAfterCents: 100, expiresAt: new Date()
    });
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
    if (oldSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = oldSecret;
  });
}

integration("history requires authentication", async () => {
  const { response } = await request(1);
  assert.equal(response.status, 401);
});
integration("history paginates grouped auctions and calculates totals without cross-user bids", async () => {
  const first = await request(1, token(user._id));
  assert.equal(first.response.status, 200);
  assert.match(first.response.headers.get("cache-control") || "", /no-store/);
  assert.equal(first.body.total, 23);
  assert.equal(first.body.limit, 20);
  assert.equal(first.body.page, 1);
  assert.equal(first.body.items.length, 20);
  assert.equal(first.body.items[0].bidCount, 3);
  assert.equal(first.body.items[0].totalSpentCents, 150);
  assert.ok(first.body.items.every(item => item.totalSpentCents === item.bidCount * 50));
  const second = await request(2, token(user._id));
  assert.equal(second.response.status, 200);
  assert.equal(second.body.total, 23);
  assert.equal(second.body.items.length, 3);
  assert.equal(new Set([...first.body.items, ...second.body.items].map(item => item.auctionId)).size, 23);
});
integration("history returns an empty page with the correct total", async () => {
  const { response, body } = await request(3, token(user._id));
  assert.equal(response.status, 200);
  assert.equal(body.total, 23);
  assert.deepEqual(body.items, []);
});
integration("history only exposes the authenticated user's participation", async () => {
  const { response, body } = await request(1, token(other._id));
  assert.equal(response.status, 200);
  assert.equal(body.total, 1);
  assert.equal(body.items.length, 1);
  assert.equal(body.items[0].bidCount, 1);
  assert.equal(body.items[0].totalSpentCents, 100);
});
