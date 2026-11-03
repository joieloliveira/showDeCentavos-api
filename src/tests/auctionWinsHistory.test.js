import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import auctionRoutes from "../routes/auctionRoutes.js";
import Auction from "../models/Auction.js";
import AuctionFulfillment from "../models/AuctionFulfillment.js";
import User from "../models/User.js";

const uri = process.env.WALLET_TEST_MONGODB_URI || "";
const safe = /^mongodb:\/\/127\.0\.0\.1:27018\/wallet_test_pix\?/.test(uri) &&
  /(?:\?|&)replicaSet=walletTestRS(?:&|$)/.test(uri);
const integration = safe ? test : test.skip;
let server, base, winner, stranger, auctions, originalSecret;
const token = id => jwt.sign({ id: String(id), role: "customer" }, process.env.JWT_SECRET);
async function request(page, authorization) {
  const response = await fetch(`${base}/api/auctions/my/wins?page=${page}`, {
    headers: authorization ? { authorization: `Bearer ${authorization}` } : {}
  });
  return { response, body: await response.json() };
}

if (safe) {
  before(async () => {
    originalSecret = process.env.JWT_SECRET;
    process.env.JWT_SECRET = "isolated-auction-wins-secret";
    await mongoose.connect(uri, {
      dbName: `auction_wins_test_${process.pid}_${Date.now()}`,
      serverSelectionTimeoutMS: 5000
    });
    winner = await User.create({ name: "Winner", email: `winner-${Date.now()}@example.test`, isActive: true });
    stranger = await User.create({ name: "Stranger", email: `stranger-${Date.now()}@example.test`, isActive: true });
    const product = new mongoose.Types.ObjectId();
    auctions = await Auction.insertMany(Array.from({ length: 23 }, (_, i) => ({
      product, winner: winner._id, status: "finished",
      bidCostCents: 50, currentPriceCents: 100 + i, bidCount: i + 1,
      endsAt: new Date(Date.now() - i * 60000)
    })));
    await Auction.create({
      product, winner: stranger._id, status: "finished", bidCostCents: 50,
      currentPriceCents: 9999, endsAt: new Date()
    });
    await Auction.create({
      product, winner: winner._id, status: "active", bidCostCents: 50,
      currentPriceCents: 9998
    });
    await AuctionFulfillment.create({
      auction: auctions[0]._id, winner: winner._id, product,
      winningPriceCents: 100, wonAt: auctions[0].endsAt,
      paymentStatus: "paid", deliveryStatus: "shipped",
      shippingAddress: {
        recipientName: "Recipient", phone: "91999999999", zipCode: "66000000",
        street: "Example", number: "10", neighborhood: "Center",
        city: "Belem", state: "PA"
      }, addressSubmittedAt: new Date()
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
    if (originalSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalSecret;
  });
}

integration("wins history requires authentication", async () => {
  assert.equal((await request(1)).response.status, 401);
});
integration("wins history paginates only finished auctions won by the authenticated user", async () => {
  const first = await request(1, token(winner._id));
  const second = await request(2, token(winner._id));
  assert.equal(first.response.status, 200);
  assert.match(first.response.headers.get("cache-control") || "", /no-store/);
  assert.equal(first.body.total, 23);
  assert.equal(first.body.limit, 20);
  assert.equal(first.body.items.length, 20);
  assert.equal(second.body.total, 23);
  assert.equal(second.body.items.length, 3);
  assert.equal(new Set([...first.body.items, ...second.body.items].map(x => x.auctionId)).size, 23);
  assert.ok(first.body.items.every(x => x.finalPriceCents < 9998 && x.fulfillmentAvailable === false));
});
integration("wins history exposes recorded fulfillment states but never implies a payment or delivery", async () => {
  const { body } = await request(1, token(winner._id));
  const recorded = body.items.find(x => x.auctionId === String(auctions[0]._id));
  const untouched = body.items.find(x => x.auctionId === String(auctions[1]._id));
  assert.equal(recorded.paymentStatus, "paid");
  assert.equal(recorded.paymentWindowStatus, "paid");
  assert.equal(recorded.paymentDeadline, new Date(auctions[0].endsAt.getTime() + 48 * 60 * 60 * 1000).toISOString());
  assert.equal(recorded.deliveryStatus, "shipped");
  assert.equal(recorded.addressEditable, false);
  assert.equal(recorded.shippingAddress.recipientName, "Recipient");
  assert.equal(untouched.paymentStatus, "not_started");
  assert.equal(untouched.paymentWindowStatus, "awaiting_payment");
  assert.equal(untouched.paymentDeadline, new Date(auctions[1].endsAt.getTime() + 48 * 60 * 60 * 1000).toISOString());
  assert.equal(untouched.deliveryStatus, "not_started");
  assert.equal(untouched.shippingAddress, null);
  assert.equal(untouched.fulfillmentAvailable, false);
});
integration("wins history isolates winners and preserves the total on empty pages", async () => {
  const outsider = await request(1, token(stranger._id));
  assert.equal(outsider.response.status, 200);
  assert.equal(outsider.body.total, 1);
  assert.equal(outsider.body.items.length, 1);
  assert.equal(outsider.body.items[0].finalPriceCents, 9999);
  assert.equal(outsider.body.items[0].shippingAddress, null);
  const empty = await request(3, token(winner._id));
  assert.equal(empty.response.status, 200);
  assert.equal(empty.body.total, 23);
  assert.deepEqual(empty.body.items, []);
});
