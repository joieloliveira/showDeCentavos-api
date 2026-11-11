import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";
import auctionRoutes from "../routes/auctionRoutes.js";
import Auction from "../models/Auction.js";
import AuctionFulfillment from "../models/AuctionFulfillment.js";
import User from "../models/User.js";

const uri = process.env.WALLET_TEST_MONGODB_URI || "";
function safeUri(value) {
  try {
    const u = new URL(value);
    return u.protocol === "mongodb:" && u.hostname === "127.0.0.1" &&
      u.port === "27018" && u.pathname === "/wallet_test_pix" &&
      u.searchParams.get("replicaSet") === "walletTestRS" && !u.username && !u.password;
  } catch { return false; }
}

test("winner and admin fulfillment views agree without exposing other winners' private addresses", {
  skip: !safeUri(uri) && "Requires isolated local MongoDB replica set",
  timeout: 30000,
}, async () => {
  const previousSecret = process.env.JWT_SECRET;
  let connected = false;
  let server;
  process.env.JWT_SECRET = "isolated-fulfillment-consistency-secret";
  try {
    await mongoose.connect(uri, {
      dbName: `auction_fulfillment_consistency_${process.pid}_${Date.now()}`,
      serverSelectionTimeoutMS: 5000,
    });
    connected = true;
    const [admin, winner, other] = await User.create([
      { name: "Admin", email: `admin-${randomUUID()}@example.invalid`, role: "admin", isActive: true },
      { name: "Winner", email: `winner-${randomUUID()}@example.invalid`, role: "customer", isActive: true },
      { name: "Other", email: `other-${randomUUID()}@example.invalid`, role: "customer", isActive: true },
    ]);
    const product = new mongoose.Types.ObjectId();
    const wonAt = new Date(Date.now() - 3600000);
    const auctions = await Auction.create([
      { product, winner: winner._id, status: "finished", bidCostCents: 50, currentPriceCents: 120, bidCount: 2, endsAt: wonAt },
      { product, winner: other._id, status: "finished", bidCostCents: 50, currentPriceCents: 200, bidCount: 3, endsAt: wonAt },
    ]);
    const address = {
      recipientName: "PRIVATE TEST RECIPIENT", phone: "91999999999",
      zipCode: "66000000", street: "Private Street", number: "10",
      neighborhood: "Center", city: "Belem", state: "PA",
    };
    await AuctionFulfillment.create([
      { auction: auctions[0]._id, winner: winner._id, product,
        winningPriceCents: 120, wonAt, paymentStatus: "paid",
        deliveryStatus: "shipped", shippingAddress: address, addressSubmittedAt: wonAt },
      { auction: auctions[1]._id, winner: other._id, product,
        winningPriceCents: 200, wonAt, paymentStatus: "pending",
        deliveryStatus: "not_started" },
    ]);
    const app = express();
    app.use(express.json());
    app.use("/api/auctions", auctionRoutes);
    server = app.listen(0, "127.0.0.1");
    await new Promise(resolve => server.once("listening", resolve));
    const base = `http://127.0.0.1:${server.address().port}/api/auctions`;
    async function get(path, user) {
      const headers = user ? { authorization: `Bearer ${jwt.sign({ id: String(user._id), role: user.role }, process.env.JWT_SECRET)}` } : {};
      const response = await fetch(base + path, { headers });
      return { status: response.status, cache: response.headers.get("cache-control"), body: await response.json() };
    }
    assert.equal((await get("/admin/fulfillments", null)).status, 401);
    assert.equal((await get("/admin/fulfillments", winner)).status, 403);
    const adminView = await get("/admin/fulfillments", admin);
    assert.equal(adminView.status, 200);
    assert.match(adminView.cache || "", /no-store/);
    assert.equal(adminView.body.total, 2);
    const mine = await get("/my/wins", winner);
    assert.equal(mine.status, 200);
    assert.match(mine.cache || "", /no-store/);
    assert.equal(mine.body.total, 1);
    const userItem = mine.body.items[0];
    const adminItem = adminView.body.items.find(x => x.auctionId === userItem.auctionId);
    assert.ok(adminItem);
    for (const key of ["paymentStatus", "deliveryStatus", "paymentWindowStatus", "paymentDeadline"]) {
      assert.deepEqual(userItem[key], adminItem[key], `Mismatch: ${key}`);
    }
    assert.equal(userItem.paymentStatus, "paid");
    assert.equal(userItem.deliveryStatus, "shipped");
    assert.equal(userItem.shippingAddress.recipientName, address.recipientName);
    assert.equal(adminItem.shippingAddress.recipientName, address.recipientName);
    assert.ok(!mine.body.items.some(x => x.auctionId === String(auctions[1]._id)));
    const otherView = await get("/my/wins", other);
    assert.equal(otherView.body.total, 1);
    assert.equal(otherView.body.items[0].paymentStatus, "pending");
    assert.ok(!JSON.stringify(otherView.body).includes(address.recipientName));
    assert.equal(await AuctionFulfillment.countDocuments(), 2);
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    if (connected) {
      await mongoose.connection.dropDatabase();
      await mongoose.disconnect();
    }
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
  }
});
