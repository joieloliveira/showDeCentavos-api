import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import Product from "../models/Product.js";
import Auction from "../models/Auction.js";
import AuctionAuditEvent from "../models/AuctionAuditEvent.js";
import { createAuction, startAuctionWaiting } from "../controllers/auctionController.js";
import { listAdminAuctionEvents } from "../controllers/adminAuctionController.js";

const uri = process.env.WALLET_TEST_MONGODB_URI;
const allowed = (() => {
  try {
    const url = new URL(uri);
    return ["127.0.0.1", "localhost"].includes(url.hostname) && url.port === "27018"
      && url.pathname === "/wallet_test_pix" && url.searchParams.get("replicaSet") === "walletTestRS";
  } catch { return false; }
})();
function response() {
  return { statusCode: 200, headers: {}, status(code) { this.statusCode = code; return this; },
    set(name, value) { this.headers[name] = value; return this; },
    json(body) { this.body = body; return this; } };
}
test("admin auction creation and waiting persist audit records; controller rejects non-admin", {
  skip: !allowed && "Requires isolated local MongoDB replica set",
}, async () => {
  const isolatedUri = uri.replace("/wallet_test_pix?", "/auction_admin_audit_isolated?");
  await mongoose.connect(isolatedUri, { serverSelectionTimeoutMS: 5000 });
  const actor = new mongoose.Types.ObjectId();
  let product;
  let auctionId;
  try {
    product = await Product.create({
      seller: actor, name: "Produto de auditoria isolada",
      slug: "audit-" + new mongoose.Types.ObjectId().toString(),
      description: "Somente teste automatizado", price: 10, status: "active",
    });
    const payload = { product: String(product._id), startPriceCents: 0, bidCostCents: 50 };
    const denied = response();
    await createAuction({ user: { id: String(actor), role: "user" }, body: payload }, denied);
    assert.equal(denied.statusCode, 403);
    const created = response();
    await createAuction({ user: { id: String(actor), role: "admin" }, body: payload }, created);
    assert.equal(created.statusCode, 201);
    auctionId = created.body.auction._id;
    const rejected = response();
    await startAuctionWaiting({ user: { id: String(actor), role: "user" }, params: { id: String(auctionId) }, body: { waitingMinutes: 1 } }, rejected);
    assert.equal(rejected.statusCode, 403);
    const started = response();
    await startAuctionWaiting({ user: { id: String(actor), role: "admin" }, params: { id: String(auctionId) }, body: { waitingMinutes: 1 } }, started);
    assert.equal(started.statusCode, 200);
    const repeated = response();
    await startAuctionWaiting({ user: { id: String(actor), role: "admin" }, params: { id: String(auctionId) }, body: { waitingMinutes: 1 } }, repeated);
    assert.equal(repeated.statusCode, 409);
    const history = response();
    await listAdminAuctionEvents({ params: { id: String(auctionId) } }, history);
    assert.equal(history.statusCode, 200);
    assert.deepEqual(history.body.events.map(e => e.eventType), ["created", "waiting_started"]);
    assert.ok(history.body.events.every(e => e.source === "admin"));
    assert.equal(await AuctionAuditEvent.countDocuments({ auction: auctionId }), 2);
  } finally {
    if (auctionId) {
      await AuctionAuditEvent.deleteMany({ auction: auctionId });
      await Auction.deleteOne({ _id: auctionId });
    }
    if (product) await Product.deleteOne({ _id: product._id });
    await mongoose.disconnect();
  }
});
