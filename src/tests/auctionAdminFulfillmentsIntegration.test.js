import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import auctionRoutes from "../routes/auctionRoutes.js";
import AuctionFulfillment from "../models/AuctionFulfillment.js";
import User from "../models/User.js";

const uri = process.env.WALLET_TEST_MONGODB_URI || "";
const safe = /^mongodb:\/\/127\.0\.0\.1:27018\/wallet_test_pix\?/.test(uri) &&
  /(?:\?|&)replicaSet=walletTestRS(?:&|$)/.test(uri);
const integration = safe ? test : test.skip;
let server, base, admin, customer, oldSecret, firstAuction;
const token = user => jwt.sign({ id: String(user._id), role: user.role }, process.env.JWT_SECRET);
async function list(user, query = "") {
  const response = await fetch(`${base}/api/auctions/admin/fulfillments${query}`, {
    headers: user ? { authorization: `Bearer ${token(user)}` } : {}
  });
  return { status: response.status, headers: response.headers, body: await response.json() };
}
if (safe) {
  before(async () => {
    oldSecret = process.env.JWT_SECRET;
    process.env.JWT_SECRET = "isolated-admin-fulfillments-secret";
    await mongoose.connect(uri, {
      dbName: `auction_admin_fulfillments_${process.pid}_${Date.now()}`,
      serverSelectionTimeoutMS: 5000
    });
    admin = await User.create({ name: "Queue Admin", email: `queue-admin-${Date.now()}@example.test`, role: "admin", isActive: true });
    customer = await User.create({ name: "Queue Customer", email: `queue-customer-${Date.now()}@example.test`, role: "customer", isActive: true });
    const product = new mongoose.Types.ObjectId();
    const records = Array.from({ length: 23 }, (_, i) => ({
      auction: new mongoose.Types.ObjectId(), winner: customer._id, product,
      winningPriceCents: 100 + i, wonAt: new Date(Date.now() - i * 60000),
      paymentStatus: i % 2 ? "pending" : "paid",
      deliveryStatus: "not_started",
      ...(i === 0 ? { shippingAddress: {
        recipientName: "PRIVATE RECIPIENT", phone: "91999999999", zipCode: "66000000",
        street: "Private Street", number: "10", neighborhood: "Center", city: "Belem", state: "PA"
      }, addressSubmittedAt: new Date() } : {})
    }));
    firstAuction = String(records[0].auction);
    await AuctionFulfillment.insertMany(records);
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
integration("fulfillment queue denies unauthenticated and non-admin users", async () => {
  assert.equal((await list(null)).status, 401);
  const response = await list(customer);
  assert.equal(response.status, 403);
  assert.ok(!JSON.stringify(response.body).includes("PRIVATE RECIPIENT"));
});
integration("admin queue paginates and returns private address only to admins", async () => {
  const first = await list(admin);
  const second = await list(admin, "?page=2");
  assert.equal(first.status, 200);
  assert.match(first.headers.get("cache-control") || "", /no-store/);
  assert.equal(first.body.total, 23);
  assert.equal(first.body.limit, 20);
  assert.equal(first.body.items.length, 20);
  assert.equal(second.body.items.length, 3);
  assert.equal(new Set([...first.body.items, ...second.body.items].map(x => x.auctionId)).size, 23);
  const privateRecord = first.body.items.find(x => x.auctionId === firstAuction);
  assert.equal(privateRecord.shippingAddress.recipientName, "PRIVATE RECIPIENT");
  assert.equal(privateRecord.paymentWindowStatus, "paid");
  assert.ok(privateRecord.paymentDeadline);
});
integration("admin queue validates filters and filters paid records", async () => {
  assert.equal((await list(admin, "?paymentStatus=invalid")).status, 400);
  assert.equal((await list(admin, "?deliveryStatus=invalid")).status, 400);
  const paid = await list(admin, "?paymentStatus=paid&deliveryStatus=not_started");
  assert.equal(paid.status, 200);
  assert.equal(paid.body.total, 12);
  assert.ok(paid.body.items.every(x => x.paymentStatus === "paid" && x.deliveryStatus === "not_started"));
});
