import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";
import auctionRoutes from "../routes/auctionRoutes.js";
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

test("concurrent administrative delivery updates advance exactly once per state", {
  skip: !safeUri(uri) && "Requires isolated local MongoDB replica set",
  timeout: 30000,
}, async () => {
  const oldSecret = process.env.JWT_SECRET;
  const oldFlag = process.env.AUCTION_DELIVERY_MANAGEMENT_ENABLED;
  let connected = false;
  let server;
  process.env.JWT_SECRET = "isolated-delivery-race-secret";
  process.env.AUCTION_DELIVERY_MANAGEMENT_ENABLED = "true";
  try {
    await mongoose.connect(uri, {
      dbName: `auction_delivery_race_${process.pid}_${Date.now()}`,
      serverSelectionTimeoutMS: 5000,
    });
    connected = true;
    const admin = await User.create({
      name: "Delivery Race Admin", email: `admin-${randomUUID()}@example.invalid`,
      role: "admin", isActive: true,
    });
    const auctionId = new mongoose.Types.ObjectId();
    await AuctionFulfillment.create({
      auction: auctionId, winner: new mongoose.Types.ObjectId(),
      product: new mongoose.Types.ObjectId(), winningPriceCents: 100,
      wonAt: new Date(), paymentStatus: "paid", deliveryStatus: "not_started",
      addressSubmittedAt: new Date(),
      shippingAddress: {
        recipientName: "Test Recipient", phone: "91999999999", zipCode: "66000000",
        street: "Test Street", number: "10", neighborhood: "Center",
        city: "Belem", state: "PA", country: "BR",
      },
    });
    const app = express();
    app.use(express.json());
    app.use("/api/auctions", auctionRoutes);
    server = app.listen(0, "127.0.0.1");
    await new Promise(resolve => server.once("listening", resolve));
    const endpoint = `http://127.0.0.1:${server.address().port}/api/auctions/admin/fulfillments/${auctionId}/delivery`;
    const token = jwt.sign({ id: String(admin._id), role: "admin" }, process.env.JWT_SECRET);
    async function advance(deliveryStatus) {
      const response = await fetch(endpoint, {
        method: "PATCH",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ deliveryStatus }),
      });
      return response.status;
    }
    for (const [target, previous] of [
      ["preparing", "not_started"],
      ["shipped", "preparing"],
      ["delivered", "shipped"],
    ]) {
      assert.equal((await AuctionFulfillment.findOne({ auction: auctionId })).deliveryStatus, previous);
      const statuses = await Promise.all(Array.from({ length: 6 }, () => advance(target)));
      assert.equal(statuses.filter(status => status === 200).length, 1, `${target}: ${statuses}`);
      assert.equal(statuses.filter(status => status === 409).length, 5, `${target}: ${statuses}`);
      const current = await AuctionFulfillment.findOne({ auction: auctionId }).lean();
      assert.equal(current.deliveryStatus, target);
      assert.equal(current.paymentStatus, "paid");
    }
    assert.equal((await AuctionFulfillment.findOne({ auction: auctionId })).deliveryStatus, "delivered");
    assert.equal(await advance("shipped"), 409);
    assert.equal(await AuctionFulfillment.countDocuments({ auction: auctionId }), 1);
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    if (connected) {
      await mongoose.connection.dropDatabase();
      await mongoose.disconnect();
    }
    if (oldSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = oldSecret;
    if (oldFlag === undefined) delete process.env.AUCTION_DELIVERY_MANAGEMENT_ENABLED;
    else process.env.AUCTION_DELIVERY_MANAGEMENT_ENABLED = oldFlag;
  }
});
