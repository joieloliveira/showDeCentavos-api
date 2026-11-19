import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import authRoutes from "../routes/authRoutes.js";
import auth from "../middlewares/auth.js";
import User from "../models/User.js";

const uri = process.env.WALLET_TEST_MONGODB_URI || "";
const safe = /^mongodb:\/\/127\.0\.0\.1:27018\/wallet_test_pix\?/.test(uri) &&
  /(?:\?|&)replicaSet=walletTestRS(?:&|$)/.test(uri) &&
  !/@|authSource=|directConnection=/.test(uri);
const integration = safe ? test : test.skip;
let server, base, active, inactive, oldSecret;
async function request(path, method = "GET", body, token) {
  const response = await fetch(base + "/api/auth" + path, {
    method, headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: "Bearer " + token } : {})
    }, ...(body ? { body: JSON.stringify(body) } : {})
  });
  return { status: response.status, body: await response.json() };
}
if (safe) {
  before(async () => {
    oldSecret = process.env.JWT_SECRET;
    process.env.JWT_SECRET = "inactive-account-http-test-secret";
    await mongoose.connect(uri, {
      dbName: `auth_inactive_http_${process.pid}_${Date.now()}`,
      serverSelectionTimeoutMS: 5000
    });
    const password = await bcrypt.hash("validPassword123!", 10);
    active = await User.create({
      name: "Active Account", email: "active-auth@example.test", password, isActive: true
    });
    inactive = await User.create({
      name: "Inactive Account", email: "inactive-auth@example.test", password, isActive: false
    });
    const app = express();
    app.use(express.json());
    app.use("/api/auth", authRoutes);
    app.get("/api/protected-check", auth, (req, res) => res.json({ id: req.user.id, role: req.user.role }));
    server = app.listen(0, "127.0.0.1");
    await new Promise(resolve => server.once("listening", resolve));
    base = "http://127.0.0.1:" + server.address().port;
  });
  after(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
    if (mongoose.connection.readyState === 1) await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    if (oldSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = oldSecret;
  });
}
integration("inactive account cannot sign in with correct password", async () => {
  const result = await request("/login", "POST", {
    email: inactive.email, password: "validPassword123!"
  });
  assert.equal(result.status, 403);
  assert.equal(result.body.token, undefined);
  assert.equal((await User.findById(inactive._id)).lastLogin, null);
});
integration("active account still signs in", async () => {
  const result = await request("/login", "POST", {
    email: active.email, password: "validPassword123!"
  });
  assert.equal(result.status, 200);
  assert.equal(typeof result.body.token, "string");
});
integration("preexisting JWT cannot read deactivated profile", async () => {
  const oldToken = jwt.sign({
    id: String(inactive._id), role: "customer"
  }, process.env.JWT_SECRET, { expiresIn: "7d" });
  const result = await request("/me", "GET", undefined, oldToken);
  assert.equal(result.status, 403);
  assert.equal(result.body.user, undefined);
});
integration("active JWT still reads own profile", async () => {
  const token = jwt.sign({
    id: String(active._id), role: "customer"
  }, process.env.JWT_SECRET, { expiresIn: "7d" });
  const result = await request("/me", "GET", undefined, token);
  assert.equal(result.status, 200);
  assert.equal(result.body.user.id, String(active._id));
});

integration("deactivated user cannot access unrelated protected endpoints with old JWT", async () => {
  const token = jwt.sign({ id: String(inactive._id), role: "admin" },
    process.env.JWT_SECRET, { expiresIn: "7d" });
  const response = await fetch(base + "/api/protected-check", {
    headers: { authorization: "Bearer " + token }
  });
  assert.equal(response.status, 403);
});
integration("JWT role cannot elevate a customer's current database permission", async () => {
  const forgedRoleToken = jwt.sign({ id: String(active._id), role: "admin" },
    process.env.JWT_SECRET, { expiresIn: "7d" });
  const response = await fetch(base + "/api/protected-check", {
    headers: { authorization: "Bearer " + forgedRoleToken }
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.role, "customer");
});
integration("removing account revokes an existing JWT on all protected routes", async () => {
  const temp = await User.create({ name: "Temporary Account",
    email: "temporary-auth@example.test", isActive: true });
  const token = jwt.sign({ id: String(temp._id), role: "customer" },
    process.env.JWT_SECRET, { expiresIn: "7d" });
  await User.deleteOne({ _id: temp._id });
  const response = await fetch(base + "/api/protected-check", {
    headers: { authorization: "Bearer " + token }
  });
  assert.equal(response.status, 403);
});
integration("malformed identity token is rejected before database lookup", async () => {
  const token = jwt.sign({ id: "not-an-object-id", role: "admin" },
    process.env.JWT_SECRET, { expiresIn: "7d" });
  const response = await fetch(base + "/api/protected-check", {
    headers: { authorization: "Bearer " + token }
  });
  assert.equal(response.status, 401);
});
