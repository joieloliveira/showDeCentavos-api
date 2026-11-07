import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import adminRoutes from "../routes/adminRoutes.js";
import User from "../models/User.js";
import FinancialReconciliationIncident from "../models/FinancialReconciliationIncident.js";

const uri = process.env.WALLET_TEST_MONGODB_URI || "";
const safe = /^mongodb:\/\/127\.0\.0\.1:27018\/wallet_test_pix\?/.test(uri) &&
  /(?:\?|&)replicaSet=walletTestRS(?:&|$)/.test(uri) &&
  !/@|authSource=|directConnection=/.test(uri);
const integration = safe ? test : test.skip;

integration("financial incidents endpoint is admin-only, filtered, paginated and read-only", async () => {
  const oldSecret = process.env.JWT_SECRET;
  let server;
  try {
    process.env.JWT_SECRET = "isolated-financial-admin-test";
    await mongoose.connect(uri, {
      dbName: `admin_financial_incidents_${process.pid}_${Date.now()}`,
      serverSelectionTimeoutMS: 5000
    });
    const admin = await User.create({ name: "Financial Admin", email: "financial-admin@example.test", role: "admin", isActive: true });
    const regular = await User.create({ name: "Regular Buyer", email: "regular-buyer@example.test", role: "user", isActive: true });
    const order = new mongoose.Types.ObjectId();
    for (const [i, status] of ["pending", "pending", "resolved"].entries()) {
      await FinancialReconciliationIncident.create({
        order, providerOrderId: `ORDER-${i}`, reason: "late_approval_after_closure", status
      });
    }
    const app = express();
    app.use("/api/admin", adminRoutes);
    server = app.listen(0, "127.0.0.1");
    await new Promise(resolve => server.once("listening", resolve));
    const base = `http://127.0.0.1:${server.address().port}/api/admin/financial/incidents`;
    const token = user => jwt.sign({ id: String(user._id) }, process.env.JWT_SECRET);
    const get = (query = "", bearer) => fetch(base + query, {
      headers: bearer ? { authorization: `Bearer ${bearer}` } : {}
    });
    assert.equal((await get()).status, 401);
    assert.equal((await get("", token(regular))).status, 403);
    assert.equal((await get("?status=invalid", token(admin))).status, 400);
    assert.equal((await get("?limit=101", token(admin))).status, 400);
    const response = await get("?status=pending&page=1&limit=1", token(admin));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const body = await response.json();
    assert.equal(body.total, 2);
    assert.equal(body.items.length, 1);
    assert.equal(body.items[0].status, "pending");
    assert.equal(await FinancialReconciliationIncident.countDocuments(), 3);
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    if (mongoose.connection.readyState === 1) await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    if (oldSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = oldSecret;
  }
});
