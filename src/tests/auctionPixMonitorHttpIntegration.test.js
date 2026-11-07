import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import auctionRoutes from "../routes/auctionRoutes.js";
import AuctionWinnerPayment from "../models/AuctionWinnerPayment.js";
import AuctionWinnerPixAttempt from "../models/AuctionWinnerPixAttempt.js";
import User from "../models/User.js";

const uri = process.env.WALLET_TEST_MONGODB_URI || "";
const safe = /^mongodb:\/\/127\.0\.0\.1:27018\/wallet_test_pix\?/.test(uri) &&
  /(?:\?|&)replicaSet=walletTestRS(?:&|$)/.test(uri) &&
  !/@|authSource=|directConnection=/.test(uri);
const integration = safe ? test : test.skip;
let server, base, admin, customer, inactive, previousSecret;
const token = user => jwt.sign({ id: String(user._id), role: user.role }, process.env.JWT_SECRET);
async function get(user, query = "") {
  const response = await fetch(`${base}/api/auctions/admin/pix-monitor${query}`, {
    headers: user ? { authorization: `Bearer ${token(user)}` } : {},
  });
  return { status: response.status, body: await response.json(),
    cache: response.headers.get("cache-control") };
}
if (safe) {
  before(async () => {
    previousSecret = process.env.JWT_SECRET;
    process.env.JWT_SECRET = "pix-monitor-isolated-test-secret";
    await mongoose.connect(uri, {
      dbName: `pix_monitor_http_${process.pid}_${Date.now()}`, serverSelectionTimeoutMS: 5000,
    });
    admin = await User.create({ name: "PIX Admin", email: "pix-admin@example.test",
      role: "admin", isActive: true });
    customer = await User.create({ name: "PIX Customer", email: "pix-customer@example.test",
      role: "customer", isActive: true });
    inactive = await User.create({ name: "Inactive PIX Admin", email: "pix-inactive@example.test",
      role: "admin", isActive: false });
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
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
  });
}
integration("PIX monitor requires an active administrator", async () => {
  assert.equal((await get(null)).status, 401);
  assert.equal((await get(customer)).status, 403);
  assert.equal((await get(inactive)).status, 403);
  assert.equal((await get(admin)).status, 200);
});
integration("PIX monitor validates filters and returns only safe read-only fields", async () => {
  assert.equal((await get(admin, "?status=unknown")).status, 400);
  assert.equal((await get(admin, "?status[]=paid")).status, 400);
  const auction1 = new mongoose.Types.ObjectId();
  const auction2 = new mongoose.Types.ObjectId();
  const p1 = await AuctionWinnerPayment.create({
    auction: auction1, fulfillment: new mongoose.Types.ObjectId(), winner: customer._id,
    amountCents: 250, status: "pending", providerOrderId: "private-provider-order-1",
  });
  const p2 = await AuctionWinnerPayment.create({
    auction: auction2, fulfillment: new mongoose.Types.ObjectId(), winner: customer._id,
    amountCents: 350, status: "paid", providerOrderId: "private-provider-order-2",
    providerPaymentId: "private-payment-id", processedAt: new Date(),
  });
  await AuctionWinnerPixAttempt.create({
    payment: p1._id, auction: auction1,
    idempotencyKey: "private-idempotency-key",
    state: "reconciliation_required", lastError: "private-provider-error",
  });
  await AuctionWinnerPixAttempt.create({
    payment: p2._id, auction: auction2,
    idempotencyKey: "private-idempotency-key-2", state: "provider_confirmed",
  });
  const all = await get(admin);
  assert.equal(all.status, 200);
  assert.equal(all.cache, "no-store");
  assert.equal(all.body.total, 2);
  assert.equal(all.body.page, 1);
  assert.equal(all.body.limit, 20);
  const review = all.body.items.find(item => item.paymentId === String(p1._id));
  assert.equal(review.requiresReview, true);
  assert.equal(review.attemptState, "reconciliation_required");
  const confirmed = all.body.items.find(item => item.paymentId === String(p2._id));
  assert.equal(confirmed.requiresReview, false);
  assert.equal(confirmed.attemptState, "provider_confirmed");
  for (const item of all.body.items) {
    assert.deepEqual(Object.keys(item).sort(), [
      "paymentId", "auctionId", "amountCents", "status",
      "createdAt", "processedAt", "attemptState", "requiresReview",
    ].sort());
  }
  const serialized = JSON.stringify(all.body);
  for (const secret of ["private-provider-order", "private-payment-id",
    "private-idempotency-key", "private-provider-error", "pix-admin@example.test"]) {
    assert.equal(serialized.includes(secret), false);
  }
  const filtered = await get(admin, "?status=pending&page=1");
  assert.equal(filtered.status, 200);
  assert.equal(filtered.body.total, 1);
  assert.equal(filtered.body.items[0].paymentId, String(p1._id));
  assert.equal((await get(admin, "?review=unknown")).status, 400);
  assert.equal((await get(admin, "?review[]=required")).status, 400);
  assert.equal((await get(admin, "?review=required&review=required")).status, 400);
  const reviewOnly = await get(admin, "?review=required");
  assert.equal(reviewOnly.status, 200);
  assert.equal(reviewOnly.body.total, 1);
  assert.equal(reviewOnly.body.items[0].paymentId, String(p1._id));
  assert.equal(reviewOnly.body.items[0].requiresReview, true);
  assert.equal((await get(admin, "?review=required&status=paid")).body.total, 0);
  assert.equal((await get(admin, "?review=required&status=pending")).body.total, 1);
  assert.equal((await get(admin, "?status=failed")).body.total, 0);
  assert.equal((await get(admin, "?page=2")).body.items.length, 0);
  assert.equal(await AuctionWinnerPayment.countDocuments(), 2);
  assert.equal(await AuctionWinnerPixAttempt.countDocuments(), 2);
});
