import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import User from "../models/User.js";

const uri = process.env.WALLET_TEST_MONGODB_URI;
const safe = (() => {
  try {
    const u = new URL(uri);
    return ["127.0.0.1", "localhost"].includes(u.hostname) &&
      u.port === "27018" && u.pathname === "/wallet_test_pix" &&
      u.searchParams.get("replicaSet") === "walletTestRS";
  } catch { return false; }
})();

test("Google identity binding remains associated with existing wallet and is explicitly readable", {
  skip: !safe && "Requires isolated MongoDB replica set",
}, async () => {
  let user;
  try {
    await mongoose.connect(uri.replace("/wallet_test_pix?", "/google_binding_isolated?"), { serverSelectionTimeoutMS: 5000 });
    await User.init();
    const email = "google-binding-" + new mongoose.Types.ObjectId() + "@example.invalid";
    user = await User.create({
      name: "Google Binding Test", email, googleId: "google-sub-existing",
      role: "customer", wallet: { balanceCents: 2400 }, isActive: true,
    });
    const normal = await User.findOne({ email });
    assert.equal(normal.googleId, undefined, "googleId must be private by default");
    const linked = await User.findOne({ email }).select("+googleId");
    assert.equal(linked.googleId, "google-sub-existing");
    assert.equal(String(linked._id), String(user._id));
    assert.equal(linked.wallet.balanceCents, 2400);
    assert.notEqual(linked.googleId, "google-sub-different");
    assert.equal(await User.countDocuments({ email }), 1);
  } finally {
    if (user) await User.deleteOne({ _id: user._id });
    await mongoose.disconnect();
  }
});
