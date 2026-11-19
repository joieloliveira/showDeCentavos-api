import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import auctionRoutes from "../routes/auctionRoutes.js";
import AuctionWinnerPayment from "../models/AuctionWinnerPayment.js";
import AuctionWinnerPixAttempt from "../models/AuctionWinnerPixAttempt.js";
import AuctionFulfillment from "../models/AuctionFulfillment.js";
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

integration("PIX reconciliation detail is admin-only, read-only and flags ledger mismatches", async () => {
  const auction = new mongoose.Types.ObjectId();
  const fulfillmentId = new mongoose.Types.ObjectId();
  const payment = await AuctionWinnerPayment.create({
    auction, fulfillment: fulfillmentId, winner: customer._id,
    amountCents: 480, status: "pending", providerOrderId: "sensitive-order-detail"
  });
  await AuctionWinnerPixAttempt.create({
    auction, payment: payment._id, idempotencyKey: "sensitive-attempt-detail",
    state: "request_unknown", lastError: "sensitive-provider-error-detail"
  });
  const url = `${base}/api/auctions/admin/pix-monitor/${payment._id}`;
  const detail = async user => {
    const response = await fetch(url, {
      headers: user ? { authorization: `Bearer ${token(user)}` } : {}
    });
    return { status: response.status, body: await response.json(),
      cache: response.headers.get("cache-control") };
  };
  assert.equal((await detail(null)).status, 401);
  assert.equal((await detail(customer)).status, 403);
  assert.equal((await detail(inactive)).status, 403);
  const invalid = await fetch(`${base}/api/auctions/admin/pix-monitor/not-an-id`, {
    headers: { authorization: `Bearer ${token(admin)}` }
  });
  assert.equal(invalid.status, 400);
  const result = await detail(admin);
  assert.equal(result.status, 200);
  assert.equal(result.cache, "no-store");
  assert.equal(result.body.requiresReview, true);
  assert.equal(result.body.ledgerConsistent, false);
  assert.equal(result.body.providerVerification, "not_performed");
  assert.equal(result.body.attempt.state, "request_unknown");
  assert.equal(result.body.fulfillment, null);
  const serialized = JSON.stringify(result.body);
  for (const secret of ["sensitive-order-detail", "sensitive-attempt-detail", "sensitive-provider-error-detail"]) {
    assert.equal(serialized.includes(secret), false);
  }
  assert.equal((await AuctionWinnerPayment.findById(payment._id)).status, "pending");
  assert.equal((await AuctionWinnerPixAttempt.findOne({ payment: payment._id })).state, "request_unknown");
});

integration("stored fulfillment and payment appear consistently in admin list and detail", async () => {
  const auction = new mongoose.Types.ObjectId();
  const fulfillment = await AuctionFulfillment.create({
    auction, winner: customer._id, product: new mongoose.Types.ObjectId(),
    winningPriceCents: 725, wonAt: new Date(),
    paymentStatus: "paid", deliveryStatus: "preparing",
    addressSubmittedAt: new Date(),
    shippingAddress: {
      recipientName: "Test Private Name", phone: "91999999999",
      zipCode: "66000000", street: "Private Street", number: "5",
      neighborhood: "Private Neighborhood", city: "Belém", state: "PA"
    }
  });
  const payment = await AuctionWinnerPayment.create({
    auction, fulfillment: fulfillment._id, winner: customer._id,
    amountCents: 725, status: "paid", processedAt: new Date(),
    providerOrderId: "private-order-consistent", providerPaymentId: "private-pix-consistent"
  });
  await AuctionWinnerPixAttempt.create({
    auction, payment: payment._id, idempotencyKey: "private-key-consistent",
    state: "provider_confirmed", providerOrderId: "private-order-consistent"
  });
  const list = await get(admin, "?status=paid");
  assert.equal(list.status, 200);
  const listed = list.body.items.find(item => item.paymentId === String(payment._id));
  assert.ok(listed);
  assert.equal(listed.amountCents, 725);
  assert.equal(listed.requiresReview, false);
  const response = await fetch(`${base}/api/auctions/admin/pix-monitor/${payment._id}`, {
    headers: { authorization: `Bearer ${token(admin)}` }
  });
  assert.equal(response.status, 200);
  const detail = await response.json();
  assert.equal(detail.paymentId, listed.paymentId);
  assert.equal(detail.auctionId, listed.auctionId);
  assert.equal(detail.ledgerConsistent, true);
  assert.equal(detail.requiresReview, false);
  assert.equal(detail.attempt.state, "provider_confirmed");
  assert.deepEqual(detail.fulfillment, {
    paymentStatus: "paid", deliveryStatus: "preparing", hasAddress: true
  });
  assert.equal(detail.providerVerification, "not_performed");
  const serialized = JSON.stringify(detail);
  for (const secret of ["private-order-consistent", "private-pix-consistent",
    "private-key-consistent", "Test Private Name", "Private Street", "91999999999"]) {
    assert.equal(serialized.includes(secret), false);
  }
  assert.equal((await AuctionWinnerPayment.findById(payment._id)).status, "paid");
  assert.equal((await AuctionFulfillment.findById(fulfillment._id)).deliveryStatus, "preparing");
});
