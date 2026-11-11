import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import auctionRoutes from "../routes/auctionRoutes.js";
import AuctionFulfillment from "../models/AuctionFulfillment.js";
import AuctionDeliveryAuditEvent from "../models/AuctionDeliveryAuditEvent.js";
import User from "../models/User.js";

const uri = process.env.WALLET_TEST_MONGODB_URI || "";
const safe = /^mongodb:\/\/127\.0\.0\.1:27018\/wallet_test_pix\?/.test(uri) &&
  /(?:\?|&)replicaSet=walletTestRS(?:&|$)/.test(uri);
const integration = safe ? test : test.skip;
let server, base, admin, customer, auctionId, oldSecret, oldFlag;
const token = user => jwt.sign({ id: String(user._id), role: user.role }, process.env.JWT_SECRET);
async function patch(user, deliveryStatus, id = auctionId) {
  const response = await fetch(`${base}/api/auctions/admin/fulfillments/${id}/delivery`, {
    method: "PATCH",
    headers: { "content-type": "application/json", ...(user ? { authorization: `Bearer ${token(user)}` } : {}) },
    body: JSON.stringify({ deliveryStatus })
  });
  return { status: response.status, body: await response.json() };
}
if (safe) {
  before(async () => {
    oldSecret = process.env.JWT_SECRET;
    oldFlag = process.env.AUCTION_DELIVERY_MANAGEMENT_ENABLED;
    process.env.JWT_SECRET = "isolated-auction-delivery-secret";
    process.env.AUCTION_DELIVERY_MANAGEMENT_ENABLED = "false";
    await mongoose.connect(uri, {
      dbName: `auction_delivery_admin_${process.pid}_${Date.now()}`,
      serverSelectionTimeoutMS: 5000
    });
    admin = await User.create({ name: "Delivery Admin", email: `delivery-admin-${Date.now()}@example.test`, role: "admin", isActive: true });
    customer = await User.create({ name: "Delivery Customer", email: `delivery-customer-${Date.now()}@example.test`, role: "customer", isActive: true });
    auctionId = new mongoose.Types.ObjectId();
    await AuctionFulfillment.create({
      auction: auctionId, winner: customer._id, product: new mongoose.Types.ObjectId(),
      winningPriceCents: 150, wonAt: new Date(),
      paymentStatus: "pending", deliveryStatus: "not_started"
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
    if (oldFlag === undefined) delete process.env.AUCTION_DELIVERY_MANAGEMENT_ENABLED;
    else process.env.AUCTION_DELIVERY_MANAGEMENT_ENABLED = oldFlag;
  });
}
integration("admin delivery is disabled by default and requires active admin", async () => {
  assert.equal((await patch(admin, "preparing")).status, 503);
  process.env.AUCTION_DELIVERY_MANAGEMENT_ENABLED = "true";
  assert.equal((await patch(null, "preparing")).status, 401);
  assert.equal((await patch(customer, "preparing")).status, 403);
  assert.equal((await patch(admin, "preparing", "bad-id")).status, 400);
  assert.equal((await patch(admin, "unknown")).status, 400);
});
integration("delivery cannot begin without confirmed payment and winner address", async () => {
  assert.equal((await patch(admin, "preparing")).status, 409);
  await AuctionFulfillment.updateOne({ auction: auctionId }, { $set: { paymentStatus: "paid" } });
  assert.equal((await patch(admin, "preparing")).status, 409);
  await AuctionFulfillment.updateOne({ auction: auctionId }, { $set: { addressSubmittedAt: new Date() } });
  assert.equal((await patch(admin, "preparing")).status, 409, "timestamp alone is not an address");
  await AuctionFulfillment.updateOne({ auction: auctionId }, { $set: {
    shippingAddress: {
      recipientName: "Winner", phone: "91999999999", zipCode: "66000000",
      street: "Test Street", number: "10", neighborhood: "Center",
      city: "Belem", state: "PA", country: "BR"
    }
  } });
});
integration("admin advances delivery in order, rejecting skips and duplicate transitions", async () => {
  assert.equal((await patch(admin, "shipped")).status, 409);
  assert.equal((await patch(admin, "delivered")).status, 409);
  assert.equal((await patch(admin, "preparing")).status, 200);
  assert.equal((await patch(admin, "preparing")).status, 409);
  assert.equal((await patch(admin, "delivered")).status, 409);
  assert.equal((await patch(admin, "shipped")).status, 200);
  assert.equal((await patch(admin, "delivered")).status, 200);
  const record = await AuctionFulfillment.findOne({ auction: auctionId }).lean();
  assert.equal(record.deliveryStatus, "delivered");
  assert.equal(record.paymentStatus, "paid");
});

integration("concurrent delivery requests accept only one transition per stage", async () => {
  for (const target of ["preparing", "shipped", "delivered"]) {
    await AuctionDeliveryAuditEvent.deleteMany({ auction: auctionId, toStatus: target });
    await AuctionFulfillment.updateOne(
      { auction: auctionId },
      { $set: { deliveryStatus: target === "preparing" ? "not_started" : target === "shipped" ? "preparing" : "shipped" } }
    );
    const results = await Promise.all([patch(admin, target), patch(admin, target)]);
    assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
    const updated = await AuctionFulfillment.findOne({ auction: auctionId });
    assert.equal(updated.deliveryStatus, target);
    assert.equal(updated.paymentStatus, "paid");
    const audit = await AuctionDeliveryAuditEvent.find({ auction: auctionId, toStatus: target }).lean();
    assert.equal(audit.length, 1);
    assert.equal(String(audit[0].actor), String(admin._id));
    assert.equal(audit[0].fromStatus, target === "preparing" ? "not_started" : target === "shipped" ? "preparing" : "shipped");
  }
});

integration("failed audit insert rolls back delivery status atomically", async () => {
  await AuctionFulfillment.updateOne(
    { auction: auctionId }, { $set: { deliveryStatus: "not_started" } }
  );
  const existing = await AuctionDeliveryAuditEvent.findOne({ auction: auctionId, toStatus: "preparing" });
  assert.ok(existing, "prior successful transition must have an audit record");
  const result = await patch(admin, "preparing");
  assert.equal(result.status, 409, "duplicate audit must reject the entire transaction as a conflict");
  const record = await AuctionFulfillment.findOne({ auction: auctionId }).lean();
  assert.equal(record.deliveryStatus, "not_started", "delivery update must roll back");
  assert.equal(await AuctionDeliveryAuditEvent.countDocuments({ auction: auctionId, toStatus: "preparing" }), 1);
});

integration("delivery audit history is admin-only, ordered, and excludes winner address", async () => {
  const url = `${base}/api/auctions/admin/fulfillments/${auctionId}/delivery-audit`;
  const get = async user => {
    const response = await fetch(url, {
      headers: user ? { authorization: `Bearer ${token(user)}` } : {}
    });
    return { status: response.status, body: await response.json(), cache: response.headers.get("cache-control") };
  };
  assert.equal((await get(null)).status, 401);
  assert.equal((await get(customer)).status, 403);
  const result = await get(admin);
  assert.equal(result.status, 200);
  assert.equal(result.cache, "no-store");
  assert.equal(result.body.auctionId, String(auctionId));
  assert.deepEqual(result.body.items.map(item => item.toStatus), ["preparing", "shipped", "delivered"]);
  for (const item of result.body.items) {
    assert.equal(item.actorId, String(admin._id));
    assert.equal(item.actorName, "Delivery Admin");
    assert.ok(item.occurredAt);
    assert.deepEqual(Object.keys(item).sort(), ["actorId", "actorName", "fromStatus", "occurredAt", "toStatus"].sort());
  }
  assert.equal((await fetch(`${base}/api/auctions/admin/fulfillments/invalid/delivery-audit`, {
    headers: { authorization: `Bearer ${token(admin)}` }
  })).status, 400);
  assert.equal((await fetch(`${base}/api/auctions/admin/fulfillments/${new mongoose.Types.ObjectId()}/delivery-audit`, {
    headers: { authorization: `Bearer ${token(admin)}` }
  })).status, 404);
});

integration("administrative fulfillment listing requires admin and supports filtered detail data", async () => {
  const url = `${base}/api/auctions/admin/fulfillments`;
  const get = async (user, suffix = "") => {
    const response = await fetch(url + suffix, {
      headers: user ? { authorization: `Bearer ${token(user)}` } : {}
    });
    return { status: response.status, body: await response.json(), cache: response.headers.get("cache-control") };
  };
  assert.equal((await get(null)).status, 401);
  assert.equal((await get(customer)).status, 403);
  assert.equal((await get(admin, "?paymentStatus=unknown")).status, 400);
  assert.equal((await get(admin, "?deliveryStatus=unknown")).status, 400);
  const result = await get(admin, "?paymentStatus=paid&deliveryStatus=not_started");
  assert.equal(result.status, 200);
  assert.equal(result.cache, "no-store");
  assert.equal(result.body.total, 1);
  const item = result.body.items[0];
  assert.equal(item.auctionId, String(auctionId));
  assert.equal(item.winnerId, String(customer._id));
  assert.equal(item.paymentStatus, "paid");
  assert.equal(item.deliveryStatus, "not_started");
  assert.equal(item.shippingAddress.recipientName, "Winner");
  assert.equal(item.shippingAddress.zipCode, "66000000");
  const empty = await get(admin, "?paymentStatus=pending");
  assert.equal(empty.status, 200);
  assert.equal(empty.body.total, 0);
  assert.deepEqual(empty.body.items, []);
});
