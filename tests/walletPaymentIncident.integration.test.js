import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";
import User from "../src/models/User.js";
import WalletDeposit from "../src/models/WalletDeposit.js";
import WalletTransaction from "../src/models/WalletTransaction.js";
import WalletPaymentIncident from "../src/models/WalletPaymentIncident.js";
import { recordWalletPaymentIncident } from "../src/services/WalletPaymentIncidentService.js";

const uri = process.env.WALLET_TEST_MONGODB_URI;
const databaseName = uri ? new URL(uri).pathname.replace(/^\//, "") : "";
const enabled = Boolean(uri && /^wallet_test_[a-z0-9_-]+$/i.test(databaseName));

test("repeated refund events create one incident and never change the wallet", {
  skip: !enabled && "Set WALLET_TEST_MONGODB_URI to a disposable wallet_test_* database",
}, async (t) => {
  let userId = null;
  let depositId = null;
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
  t.after(async () => {
    try {
      if (depositId) {
        await WalletPaymentIncident.deleteMany({ deposit: depositId });
        await WalletTransaction.deleteMany({ deposit: depositId });
        await WalletDeposit.deleteOne({ _id: depositId });
      }
      if (userId) await User.deleteOne({ _id: userId });
    } finally {
      await mongoose.disconnect();
    }
  });
  await Promise.all([User.init(), WalletDeposit.init(), WalletPaymentIncident.init()]);
  const unique = new mongoose.Types.ObjectId().toString();
  const user = await User.create({
    name: "Incident Test", email: `incident-${unique}@example.invalid`,
    isActive: true, wallet: { balanceCents: 700 },
  });
  userId = user._id;
  const providerOrderId = `ORD-INCIDENT-${unique}`;
  const deposit = await WalletDeposit.create({
    user: user._id, amountCents: 1000, provider: "mercadopago",
    providerOrderId, status: "approved", processedAt: new Date(),
  });
  depositId = deposit._id;
  const providerOrder = {
    orderId: providerOrderId,
    externalReference: String(deposit._id),
    normalizedStatus: "refunded",
  };

  await recordWalletPaymentIncident({ deposit, providerOrder });
  await recordWalletPaymentIncident({ deposit, providerOrder });

  const [incidents, updatedUser, transactions, updatedDeposit] = await Promise.all([
    WalletPaymentIncident.find({ deposit: deposit._id }).lean(),
    User.findById(user._id).lean(),
    WalletTransaction.find({ deposit: deposit._id }).lean(),
    WalletDeposit.findById(deposit._id).lean(),
  ]);
  assert.equal(incidents.length, 1);
  assert.equal(incidents[0].resolution, "review_required");
  assert.equal(incidents[0].providerStatus, "refunded");
  assert.equal(updatedUser.wallet.balanceCents, 700);
  assert.equal(updatedDeposit.status, "approved");
  assert.equal(transactions.length, 0);
});
