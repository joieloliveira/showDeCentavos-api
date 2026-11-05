import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import express from "express";
import jwt from "jsonwebtoken";
import Auction from "../models/Auction.js";
import Bid from "../models/Bid.js";
import User from "../models/User.js";
import WalletTransaction from "../models/WalletTransaction.js";
import adminRoutes from "../routes/adminRoutes.js";

const uri = process.env.WALLET_TEST_MONGODB_URI;
const isolated = (() => {
  try {
    const u = new URL(uri);
    return ["localhost", "127.0.0.1"].includes(u.hostname) &&
      u.port === "27018" && u.pathname === "/wallet_test_pix" &&
      u.searchParams.get("replicaSet") === "walletTestRS";
  } catch { return false; }
})();

test("auction reconciliation summary covers all bids, empty auctions and admin permissions", {
  skip: !isolated && "Requires isolated local MongoDB replica set",
}, async () => {
  const testUri = uri.replace("/wallet_test_pix?", "/auction_bid_summary_isolated?");
  const previousSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = "isolated-summary-test-only";
  let server, admin, customer, auction, emptyAuction;
  try {
    await mongoose.connect(testUri, { serverSelectionTimeoutMS: 5000 });
    admin = await User.create({ name: "Admin Resumo", email: "admin-" + new mongoose.Types.ObjectId() + "@example.invalid", role: "admin", isActive: true });
    customer = await User.create({ name: "Cliente Resumo", email: "client-" + new mongoose.Types.ObjectId() + "@example.invalid", role: "customer", isActive: true });
    auction = await Auction.create({ product: new mongoose.Types.ObjectId(), bidCostCents: 50 });
    emptyAuction = await Auction.create({ product: new mongoose.Types.ObjectId(), bidCostCents: 50 });
    const bids = await Bid.create(Array.from({ length: 23 }, (_, i) => ({
      auction: auction._id, user: customer._id, idempotencyKey: "summary-" + i,
      bidCostCents: 50, priceBeforeCents: i, priceAfterCents: i + 1,
      balanceAfterCents: 2000 - 50 * (i + 1), expiresAt: new Date(Date.now() + 15000),
    })));
    await WalletTransaction.create(bids.flatMap((bid, i) => {
      if (i >= 10 && i < 18) return [];
      return [{
        user: customer._id, type: "bid", auction: auction._id, bid: bid._id,
        amountCents: i >= 18 ? -40 : -50, balanceAfterCents: bid.balanceAfterCents,
      }];
    }));
    const app = express();
    app.use("/api/admin", adminRoutes);
    server = await new Promise(resolve => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
    const base = "http://127.0.0.1:" + server.address().port + "/api/admin/auctions/";
    const sign = user => jwt.sign({ id: String(user._id), role: user.role }, process.env.JWT_SECRET, { expiresIn: "5m" });
    const request = async (path, token) => {
      const response = await fetch(base + path, { headers: token ? { Authorization: "Bearer " + token } : {} });
      return { status: response.status, body: await response.json() };
    };
    const path = auction._id + "/bids/summary";
    assert.equal((await request(path)).status, 401);
    assert.equal((await request(path, sign(customer))).status, 403);
    const result = await request(path, sign(admin));
    assert.equal(result.status, 200);
    assert.deepEqual(result.body.summary, { total: 23, matched: 10, missing: 8, mismatch: 5 });
    const paged = await request(auction._id + "/bids?page=2&limit=2", sign(admin));
    assert.equal(paged.status, 200);
    assert.equal(paged.body.bids.length, 2);
    assert.equal((await request(path, sign(admin))).body.summary.total, 23);
    const empty = await request(emptyAuction._id + "/bids/summary", sign(admin));
    assert.equal(empty.status, 200);
    assert.deepEqual(empty.body.summary, { total: 0, matched: 0, missing: 0, mismatch: 0 });
    assert.equal((await request("invalid/bids/summary", sign(admin))).status, 400);
    assert.equal((await request(new mongoose.Types.ObjectId() + "/bids/summary", sign(admin))).status, 404);
    await User.updateOne({ _id: admin._id }, { $set: { isActive: false } });
    assert.equal((await request(path, sign(admin))).status, 403);
  } finally {
    if (server) await new Promise((resolve, reject) => server.close(e => e ? reject(e) : resolve()));
    if (auction) {
      await WalletTransaction.deleteMany({ auction: auction._id });
      await Bid.deleteMany({ auction: auction._id });
      await Auction.deleteOne({ _id: auction._id });
    }
    if (emptyAuction) await Auction.deleteOne({ _id: emptyAuction._id });
    if (admin) await User.deleteOne({ _id: admin._id });
    if (customer) await User.deleteOne({ _id: customer._id });
    await mongoose.disconnect();
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
  }
});
