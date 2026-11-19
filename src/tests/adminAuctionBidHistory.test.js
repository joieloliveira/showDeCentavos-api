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
const safe = (() => {
  try {
    const u = new URL(uri);
    return ["localhost", "127.0.0.1"].includes(u.hostname) &&
      u.port === "27018" && u.pathname === "/wallet_test_pix" &&
      u.searchParams.get("replicaSet") === "walletTestRS";
  } catch { return false; }
})();

test("admin bid history reconciles matched, missing and mismatched ledger records with access controls", {
  skip: !safe && "Requires local isolated MongoDB replica set",
}, async () => {
  const dbUri = uri.replace("/wallet_test_pix?", "/auction_bid_history_isolated?");
  const previousSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = "isolated-bid-history-test-secret";
  let server, admin, customer, auction;
  try {
    await mongoose.connect(dbUri, { serverSelectionTimeoutMS: 5000 });
    admin = await User.create({ name: "Admin Historico", email: "admin-" + new mongoose.Types.ObjectId() + "@example.invalid", role: "admin", isActive: true });
    customer = await User.create({ name: "Cliente Historico", email: "client-" + new mongoose.Types.ObjectId() + "@example.invalid", role: "customer", isActive: true });
    auction = await Auction.create({ product: new mongoose.Types.ObjectId(), bidCostCents: 50 });
    const bids = await Bid.create([0, 1, 2].map(i => ({
      auction: auction._id, user: customer._id, idempotencyKey: "audit-bid-" + i,
      bidCostCents: 50, priceBeforeCents: i, priceAfterCents: i + 1,
      balanceAfterCents: 950 - i * 50, expiresAt: new Date(Date.now() + 15000),
    })));
    await WalletTransaction.create([
      { user: customer._id, type: "bid", auction: auction._id, bid: bids[0]._id, amountCents: -50, balanceAfterCents: 950 },
      { user: customer._id, type: "bid", auction: auction._id, bid: bids[2]._id, amountCents: -40, balanceAfterCents: 850 },
    ]);
    const app = express();
    app.use("/api/admin", adminRoutes);
    server = await new Promise(resolve => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
    const endpoint = "http://127.0.0.1:" + server.address().port + "/api/admin/auctions/" + auction._id + "/bids";
    const token = user => jwt.sign({ id: String(user._id), role: user.role }, process.env.JWT_SECRET, { expiresIn: "5m" });
    const get = async (url, auth) => {
      const response = await fetch(url, { headers: auth ? { Authorization: "Bearer " + auth } : {} });
      return { status: response.status, data: await response.json() };
    };
    assert.equal((await get(endpoint)).status, 401);
    assert.equal((await get(endpoint, token(customer))).status, 403);
    const full = await get(endpoint, token(admin));
    assert.equal(full.status, 200);
    assert.equal(full.data.pagination.total, 3);
    const statuses = Object.fromEntries(full.data.bids.map(b => [String(b.bidId), b.ledgerStatus]));
    assert.equal(statuses[String(bids[0]._id)], "matched");
    assert.equal(statuses[String(bids[1]._id)], "missing");
    assert.equal(statuses[String(bids[2]._id)], "mismatch");
    const page = await get(endpoint + "?page=2&limit=1", token(admin));
    assert.equal(page.status, 200);
    assert.equal(page.data.bids.length, 1);
    assert.equal(page.data.pagination.totalPages, 3);
    assert.equal((await get(endpoint + "?limit=101", token(admin))).status, 400);
    await User.updateOne({ _id: admin._id }, { $set: { isActive: false } });
    assert.equal((await get(endpoint, token(admin))).status, 403);
  } finally {
    if (server) await new Promise((resolve, reject) => server.close(e => e ? reject(e) : resolve()));
    if (auction) {
      await WalletTransaction.deleteMany({ auction: auction._id });
      await Bid.deleteMany({ auction: auction._id });
      await Auction.deleteOne({ _id: auction._id });
    }
    if (admin) await User.deleteOne({ _id: admin._id });
    if (customer) await User.deleteOne({ _id: customer._id });
    await mongoose.disconnect();
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
  }
});
