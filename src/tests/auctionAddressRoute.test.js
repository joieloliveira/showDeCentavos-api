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
let server, base, winner, outsider, auction, oldSecret, oldFlag;
const token = id => jwt.sign({ id: String(id), role: "customer" }, process.env.JWT_SECRET);
const address = {
  recipientName: "Recipient", phone: "(91) 99999-9999", zipCode: "66000-000",
  street: "Example Street", number: "10", complement: "", neighborhood: "Center",
  city: "Belem", state: "PA"
};
async function put(authorization, body = address, id = auction._id) {
  const response = await fetch(`${base}/api/auctions/my/wins/${id}/address`, {
    method: "PUT", headers: {
      "content-type": "application/json",
      ...(authorization ? { authorization: `Bearer ${authorization}` } : {})
    }, body: JSON.stringify(body)
  });
  return { response, body: await response.json() };
}
if (safe) {
  before(async () => {
    oldSecret = process.env.JWT_SECRET;
    oldFlag = process.env.AUCTION_ADDRESS_COLLECTION_ENABLED;
    process.env.JWT_SECRET = "isolated-auction-address-route-secret";
    process.env.AUCTION_ADDRESS_COLLECTION_ENABLED = "false";
    await mongoose.connect(uri, {
      dbName: `auction_address_route_test_${process.pid}_${Date.now()}`,
      serverSelectionTimeoutMS: 5000
    });
    winner = await User.create({ name: "Address Winner", email: `address-winner-${Date.now()}@example.test`, isActive: true });
    outsider = await User.create({ name: "Address Outsider", email: `address-outsider-${Date.now()}@example.test`, isActive: true });
    auction = await Auction.create({
      product: new mongoose.Types.ObjectId(), winner: winner._id, status: "finished",
      bidCostCents: 50, currentPriceCents: 100, endsAt: new Date()
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
    if (oldSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = oldSecret;
    if (oldFlag === undefined) delete process.env.AUCTION_ADDRESS_COLLECTION_ENABLED;
    else process.env.AUCTION_ADDRESS_COLLECTION_ENABLED = oldFlag;
  });
}
integration("address endpoint requires authentication", async () => {
  assert.equal((await put(null)).response.status, 401);
  assert.equal(await AuctionFulfillment.countDocuments(), 0);
});
integration("disabled address feature rejects writes without storing personal data", async () => {
  const result = await put(token(winner._id));
  assert.equal(result.response.status, 503);
  assert.equal(await AuctionFulfillment.countDocuments(), 0);
});
integration("address endpoint rejects non-winner even when enabled for isolated testing", async () => {
  process.env.AUCTION_ADDRESS_COLLECTION_ENABLED = "true";
  try {
    const result = await put(token(outsider._id));
    assert.equal(result.response.status, 404);
    assert.equal(await AuctionFulfillment.countDocuments(), 0);
  } finally { process.env.AUCTION_ADDRESS_COLLECTION_ENABLED = "false"; }
});
integration("address endpoint validates data and blocks malformed auction IDs", async () => {
  process.env.AUCTION_ADDRESS_COLLECTION_ENABLED = "true";
  try {
    assert.equal((await put(token(winner._id), address, "not-an-id")).response.status, 400);
    assert.equal((await put(token(winner._id), { ...address, zipCode: "invalid" })).response.status, 400);
    assert.equal(await AuctionFulfillment.countDocuments(), 0);
  } finally { process.env.AUCTION_ADDRESS_COLLECTION_ENABLED = "false"; }
});
integration("address endpoint locks changes after delivery has started", async () => {
  await AuctionFulfillment.create({
    auction: auction._id, winner: winner._id, product: auction.product,
    winningPriceCents: 100, wonAt: auction.endsAt, deliveryStatus: "shipped"
  });
  process.env.AUCTION_ADDRESS_COLLECTION_ENABLED = "true";
  try {
    const result = await put(token(winner._id));
    assert.equal(result.response.status, 409);
    const stored = await AuctionFulfillment.findOne({ auction: auction._id }).lean();
    assert.equal(stored.shippingAddress?.recipientName, undefined);
    assert.equal(stored.deliveryStatus, "shipped");
  } finally { process.env.AUCTION_ADDRESS_COLLECTION_ENABLED = "false"; }
});

integration("winner can save and update an address without duplicate fulfillment records", async () => {
  // Reset the fixture from the delivery-lock test without affecting any real database.
  await AuctionFulfillment.deleteMany({ auction: auction._id });
  process.env.AUCTION_ADDRESS_COLLECTION_ENABLED = "true";
  try {
    const first = await put(token(winner._id));
    assert.equal(first.response.status, 200);
    assert.equal(first.body.shippingAddress.recipientName, "Recipient");
    assert.equal(first.body.shippingAddress.zipCode, "66000000");
    assert.equal(first.body.shippingAddress.phone, "91999999999");
    assert.equal(await AuctionFulfillment.countDocuments({ auction: auction._id }), 1);
    const updated = await put(token(winner._id), { ...address, number: "25", complement: "Apartment 2" });
    assert.equal(updated.response.status, 200);
    assert.equal(updated.body.shippingAddress.number, "25");
    assert.equal(updated.body.shippingAddress.complement, "Apartment 2");
    const records = await AuctionFulfillment.find({ auction: auction._id }).lean();
    assert.equal(records.length, 1);
    assert.equal(String(records[0].winner), String(winner._id));
    assert.equal(records[0].shippingAddress.number, "25");
    assert.equal(records[0].paymentStatus, "not_started");
    assert.equal(records[0].deliveryStatus, "not_started");
    assert.ok(records[0].addressSubmittedAt);
  } finally { process.env.AUCTION_ADDRESS_COLLECTION_ENABLED = "false"; }
});
integration("saving an address does not permit another user to overwrite it", async () => {
  process.env.AUCTION_ADDRESS_COLLECTION_ENABLED = "true";
  try {
    const before = await AuctionFulfillment.findOne({ auction: auction._id }).lean();
    const attempt = await put(token(outsider._id), { ...address, number: "999" });
    assert.equal(attempt.response.status, 404);
    const afterRecord = await AuctionFulfillment.findOne({ auction: auction._id }).lean();
    assert.equal(afterRecord.shippingAddress.number, before.shippingAddress.number);
    assert.equal(await AuctionFulfillment.countDocuments({ auction: auction._id }), 1);
  } finally { process.env.AUCTION_ADDRESS_COLLECTION_ENABLED = "false"; }
});
