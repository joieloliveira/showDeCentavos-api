import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import adminRoutes from "../routes/adminRoutes.js";
import User from "../models/User.js";
import FinancialReconciliationIncident from "../models/FinancialReconciliationIncident.js";
import FinancialIncidentAudit from "../models/FinancialIncidentAudit.js";

const uri = process.env.WALLET_TEST_MONGODB_URI || "";
const safe = /^mongodb:\/\/127\.0\.0\.1:27018\/wallet_test_pix\?/.test(uri) &&
  /(?:\?|&)replicaSet=walletTestRS(?:&|$)/.test(uri) &&
  !/@|authSource=|directConnection=/.test(uri);
(safe ? test : test.skip)("admin incident transitions require justification and persist audit atomically", async () => {
  const oldSecret = process.env.JWT_SECRET;
  let server;
  try {
    process.env.JWT_SECRET = "isolated-financial-transition-test";
    await mongoose.connect(uri, {
      dbName: `admin_financial_transitions_${process.pid}_${Date.now()}`,
      serverSelectionTimeoutMS: 5000
    });
    const admin = await User.create({ name: "Admin", email: "audit-admin@example.test", role: "admin", isActive: true });
    const regular = await User.create({ name: "Buyer", email: "audit-buyer@example.test", role: "customer", isActive: true });
    const incident = await FinancialReconciliationIncident.create({
      order: new mongoose.Types.ObjectId(), providerOrderId: "ORD-AUDIT",
      reason: "approved_amount_mismatch"
    });
    const app = express();
    app.use(express.json());
    app.use("/api/admin", adminRoutes);
    server = app.listen(0, "127.0.0.1");
    await new Promise(resolve => server.once("listening", resolve));
    const base = `http://127.0.0.1:${server.address().port}/api/admin/financial/incidents/${incident._id}`;
    const token = user => jwt.sign({ id: String(user._id) }, process.env.JWT_SECRET);
    const patch = (status, note, bearer) => fetch(base, {
      method: "PATCH", headers: { "content-type": "application/json", ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) },
      body: JSON.stringify({ status, note })
    });
    assert.equal((await patch("investigating", "Checking", null)).status, 401);
    assert.equal((await patch("investigating", "Checking", token(regular))).status, 403);
    assert.equal((await patch("resolved", "Skipping investigation", token(admin))).status, 409);
    assert.equal((await patch("investigating", "", token(admin))).status, 400);
    assert.equal((await patch("investigating", "Investigating provider statement", token(admin))).status, 200);
    assert.equal((await patch("investigating", "Repeated", token(admin))).status, 409);
    assert.equal((await patch("resolved", "Reconciled manually with provider", token(admin))).status, 200);
    assert.equal((await patch("resolved", "Repeated", token(admin))).status, 409);
    const history = await fetch(base + "/audit", { headers: { authorization: `Bearer ${token(admin)}` } });
    assert.equal(history.status, 200);
    const data = await history.json();
    assert.equal(data.items.length, 2);
    assert.equal(data.items[0].toStatus, "resolved");
    assert.equal(data.items[1].toStatus, "investigating");
    assert.equal(String(data.items[0].actor), String(admin._id));
    assert.equal(await FinancialIncidentAudit.countDocuments({ incident: incident._id }), 2);
    assert.equal((await FinancialReconciliationIncident.findById(incident._id)).status, "resolved");
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    if (mongoose.connection.readyState === 1) await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    if (oldSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = oldSecret;
  }
});
