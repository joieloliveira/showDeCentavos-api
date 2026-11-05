import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import auctionRoutes from "../routes/auctionRoutes.js";
import Auction from "../models/Auction.js";
import AuctionFulfillment from "../models/AuctionFulfillment.js";

const uri = process.env.WALLET_TEST_MONGODB_URI || "";
const safe = /^mongodb:\/\/127\.0\.0\.1:27018\/wallet_test_pix\?/.test(uri) && /(?:\?|&)replicaSet=walletTestRS(?:&|$)/.test(uri);
const integration = safe ? test : test.skip;
let server, base, winner, other, firstId, secondId, originalSecret;
const token = id => jwt.sign({ id: String(id), role: "user" }, process.env.JWT_SECRET);
async function getWins(authToken) {
  const res = await fetch(`${base}/api/auctions/my/wins`, { headers: authToken ? { authorization: `Bearer ${authToken}` } : {} });
  return { status: res.status, body: await res.json() };
}
if (safe) {
  before(async () => {
    originalSecret = process.env.JWT_SECRET;
    process.env.JWT_SECRET = "isolated-auction-address-read-secret";
    await mongoose.connect(uri, { dbName: `auction_address_read_test_${process.pid}_${Date.now()}`, serverSelectionTimeoutMS: 5000 });
    winner = new mongoose.Types.ObjectId();
    other = new mongoose.Types.ObjectId();
    const product = new mongoose.Types.ObjectId();
    const wonAt = new Date("2026-11-01T10:00:00Z");
    const result = await Auction.collection.insertMany([
      { product, winner, status: "finished", currentPriceCents: 200, endsAt: wonAt, bidCount: 3 },
      { product, winner: other, status: "finished", currentPriceCents: 300, endsAt: wonAt, bidCount: 4 }
    ]);
    firstId = result.insertedIds[0];
    secondId = result.insertedIds[1];
    await AuctionFulfillment.collection.insertMany([
      {
        auction: firstId, winner, product, winningPriceCents: 200, wonAt,
        paymentStatus: "pending", deliveryStatus: "not_started",
        shippingAddress: { recipientName: "Test Winner", phone: "91999999999", zipCode: "66000000", street: "Test Street", number: "10", neighborhood: "Test", city: "Belem", state: "PA", country: "BR" },
        addressSubmittedAt: wonAt
      },
      {
        auction: secondId, winner: other, product, winningPriceCents: 300, wonAt,
        paymentStatus: "paid", deliveryStatus: "shipped",
        shippingAddress: { recipientName: "SECRET OTHER USER", phone: "11999999999", zipCode: "01000000", street: "Private Street", number: "99", neighborhood: "Private", city: "Sao Paulo", state: "SP", country: "BR" },
        addressSubmittedAt: wonAt
      }
    ]);
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

integration("GET wins requires authentication", async () => {
  assert.equal((await getWins()).status, 401);
  assert.equal((await getWins("invalid")).status, 401);
});
integration("GET wins only returns authenticated winner's address", async () => {
  const result = await getWins(token(winner));
  assert.equal(result.status, 200);
  assert.equal(result.body.total, 1);
  assert.equal(result.body.items.length, 1);
  assert.equal(result.body.items[0].auctionId, String(firstId));
  assert.equal(result.body.items[0].shippingAddress.recipientName, "Test Winner");
  assert.equal(result.body.items[0].addressEditable, true);
  assert.equal(result.body.items[0].paymentStatus, "pending");
  assert.equal(result.body.items[0].deliveryStatus, "not_started");
  assert.ok(!JSON.stringify(result.body).includes("SECRET OTHER USER"));
});
integration("GET wins returns different owner's address only to that owner", async () => {
  const result = await getWins(token(other));
  assert.equal(result.status, 200);
  assert.equal(result.body.total, 1);
  assert.equal(result.body.items[0].auctionId, String(secondId));
  assert.equal(result.body.items[0].shippingAddress.recipientName, "SECRET OTHER USER");
  assert.equal(result.body.items[0].addressEditable, false);
  assert.equal(result.body.items[0].paymentStatus, "paid");
  assert.equal(result.body.items[0].deliveryStatus, "shipped");
  assert.ok(!JSON.stringify(result.body).includes("Test Winner"));
});
integration("GET wins does not expose address to unrelated user", async () => {
  const result = await getWins(token(new mongoose.Types.ObjectId()));
  assert.equal(result.status, 200);
  assert.equal(result.body.total, 0);
  assert.deepEqual(result.body.items, []);
});
