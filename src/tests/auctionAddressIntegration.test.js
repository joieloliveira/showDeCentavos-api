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
let server, base, winner, stranger, finishedId, activeId, originalFlag, originalSecret;
const address = {
  recipientName: "Destinatário Fictício", phone: "91999999999", zipCode: "66000000",
  street: "Rua de Teste", number: "42", complement: "", neighborhood: "Centro",
  city: "Belém", state: "PA", paymentStatus: "paid", deliveryStatus: "shipped",
  winner: "000000000000000000000001"
};
const token = id => jwt.sign({ id: String(id), role: "user" }, process.env.JWT_SECRET);
async function put(id, bearer, body = address) {
  const res = await fetch(`${base}/api/auctions/my/wins/${id}/address`, {
    method: "PUT", headers: { "content-type": "application/json", ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) },
    body: JSON.stringify(body)
  });
  return { status: res.status, body: await res.json() };
}
if (safe) {
  before(async () => {
    originalFlag = process.env.AUCTION_ADDRESS_COLLECTION_ENABLED;
    originalSecret = process.env.JWT_SECRET;
    process.env.AUCTION_ADDRESS_COLLECTION_ENABLED = "true";
    process.env.JWT_SECRET = "isolated-auction-address-test-secret";
    // Never connect to the application's real database; use a unique, temporary database.
    await mongoose.connect(uri, { dbName: `auction_address_test_${process.pid}_${Date.now()}`, serverSelectionTimeoutMS: 5000 });
    await AuctionFulfillment.createCollection();
    await AuctionFulfillment.createIndexes();
    winner = new mongoose.Types.ObjectId();
    stranger = new mongoose.Types.ObjectId();
    const product = new mongoose.Types.ObjectId();
    const wonAt = new Date("2026-11-01T10:00:00.000Z");
    const result = await Auction.collection.insertMany([
      { product, winner, status: "finished", currentPriceCents: 123, endsAt: wonAt },
      { product, winner, status: "active", currentPriceCents: 123, endsAt: wonAt }
    ]);
    finishedId = result.insertedIds[0];
    activeId = result.insertedIds[1];
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
    if (originalFlag === undefined) delete process.env.AUCTION_ADDRESS_COLLECTION_ENABLED;
    else process.env.AUCTION_ADDRESS_COLLECTION_ENABLED = originalFlag;
    if (originalSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalSecret;
  });
}

integration("HTTP denies missing and invalid JWT", async () => {
  assert.equal((await put(finishedId)).status, 401);
  assert.equal((await put(finishedId, "invalid-token")).status, 401);
});
integration("HTTP denies another winner and unfinished auctions", async () => {
  assert.equal((await put(finishedId, token(stranger))).status, 404);
  assert.equal((await put(activeId, token(winner))).status, 404);
});
integration("HTTP rejects invalid address", async () => {
  assert.equal((await put(finishedId, token(winner), { ...address, zipCode: "invalid" })).status, 400);
});
integration("HTTP persists only allowlisted address fields and preserves financial fields", async () => {
  const result = await put(finishedId, token(winner));
  assert.equal(result.status, 200);
  const record = await AuctionFulfillment.findOne({ auction: finishedId }).lean();
  assert.equal(String(record.winner), String(winner));
  assert.equal(record.paymentStatus, "not_started");
  assert.equal(record.deliveryStatus, "not_started");
  assert.equal(record.winningPriceCents, 123);
  assert.equal(record.shippingAddress.zipCode, "66000000");
  assert.equal(record.shippingAddress.paymentStatus, undefined);
  assert.equal(await AuctionFulfillment.countDocuments({ auction: finishedId }), 1);
});
integration("HTTP blocks edits once delivery has started", async () => {
  await AuctionFulfillment.updateOne({ auction: finishedId }, { $set: { deliveryStatus: "preparing" } });
  assert.equal((await put(finishedId, token(winner))).status, 409);
  await AuctionFulfillment.updateOne({ auction: finishedId }, { $set: { deliveryStatus: "not_started" } });
});
integration("HTTP concurrent requests cannot create duplicate fulfillment records", async () => {
  await AuctionFulfillment.deleteOne({ auction: finishedId });
  const results = await Promise.all(Array.from({ length: 6 }, () => put(finishedId, token(winner))));
  assert.ok(results.every(r => [200, 409].includes(r.status)));
  assert.equal(await AuctionFulfillment.countDocuments({ auction: finishedId }), 1);
});
integration("HTTP feature flag blocks address writes", async () => {
  process.env.AUCTION_ADDRESS_COLLECTION_ENABLED = "false";
  try { assert.equal((await put(finishedId, token(winner))).status, 503); }
  finally { process.env.AUCTION_ADDRESS_COLLECTION_ENABLED = "true"; }
});
