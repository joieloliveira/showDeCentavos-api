import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import express from "express";
import User from "../models/User.js";
import Auction from "../models/Auction.js";
import AuctionAuditEvent from "../models/AuctionAuditEvent.js";
import adminRoutes from "../routes/adminRoutes.js";

const uri = process.env.WALLET_TEST_MONGODB_URI;
const safe = (() => {
  try {
    const u = new URL(uri);
    return ["localhost", "127.0.0.1"].includes(u.hostname) &&
      u.port === "27018" && u.pathname === "/wallet_test_pix" &&
      u.searchParams.get("replicaSet") === "walletTestRS";
  } catch { return false; }
})();

test("audit endpoint enforces authentication and active administrator authorization", {
  skip: !safe && "Requires isolated local MongoDB replica set",
}, async () => {
  const testUri = uri.replace("/wallet_test_pix?", "/auction_http_auth_isolated?");
  const originalSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = "local-audit-test-only-secret";
  let server;
  let admin;
  let customer;
  let auction;
  try {
    await mongoose.connect(testUri, { serverSelectionTimeoutMS: 5000 });
    admin = await User.create({ name: "Admin Teste", email: "admin-" + new mongoose.Types.ObjectId() + "@example.invalid", role: "admin", isActive: true });
    customer = await User.create({ name: "Cliente Teste", email: "client-" + new mongoose.Types.ObjectId() + "@example.invalid", role: "customer", isActive: true });
    auction = await Auction.create({ product: new mongoose.Types.ObjectId(), bidCostCents: 50 });
    await AuctionAuditEvent.create({ auction: auction._id, eventType: "created", occurredAt: new Date(), source: "admin", actor: admin._id });

    const app = express();
    app.use("/api/admin", adminRoutes);
    server = await new Promise(resolve => {
      const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
    });
    const endpoint = "http://127.0.0.1:" + server.address().port + "/api/admin/auctions/" + auction._id + "/events";
    const request = async token => {
      const headers = token ? { Authorization: "Bearer " + token } : {};
      const response = await fetch(endpoint, { headers });
      return { status: response.status, body: await response.json() };
    };
    const sign = user => jwt.sign({ id: String(user._id), role: user.role }, process.env.JWT_SECRET, { expiresIn: "5m" });

    assert.equal((await request()).status, 401);
    assert.equal((await request("invalid")).status, 401);
    assert.equal((await request(sign(customer))).status, 403);
    const accepted = await request(sign(admin));
    assert.equal(accepted.status, 200);
    assert.deepEqual(accepted.body.events.map(event => event.eventType), ["created"]);
    await User.updateOne({ _id: admin._id }, { $set: { isActive: false } });
    assert.equal((await request(sign(admin))).status, 403);
  } finally {
    if (server) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    if (auction) {
      await AuctionAuditEvent.deleteMany({ auction: auction._id });
      await Auction.deleteOne({ _id: auction._id });
    }
    if (admin) await User.deleteOne({ _id: admin._id });
    if (customer) await User.deleteOne({ _id: customer._id });
    await mongoose.disconnect();
    if (originalSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalSecret;
  }
});
