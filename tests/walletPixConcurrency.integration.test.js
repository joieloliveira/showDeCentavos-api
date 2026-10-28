import assert from "node:assert/strict";
import test, { mock } from "node:test";
import mongoose from "mongoose";
import User from "../src/models/User.js";
import WalletDeposit from "../src/models/WalletDeposit.js";
import WalletTransaction from "../src/models/WalletTransaction.js";
import MercadoPagoProvider from "../src/services/payments/MercadoPagoProvider.js";
import { processApprovedMercadoPagoWalletDeposit } from "../src/services/MercadoPagoWalletDepositService.js";

// Explicit opt-in. NEVER use the application's production MONGODB_URI.
// The URI must name a disposable database beginning with wallet_test_.
const uri = process.env.WALLET_TEST_MONGODB_URI;
const databaseName = uri ? new URL(uri).pathname.replace(/^\//, "") : "";
const enabled = Boolean(uri && /^wallet_test_[a-z0-9_-]+$/i.test(databaseName));

test("concurrent PIX confirmations credit a deposit exactly once", { skip: !enabled && "Set WALLET_TEST_MONGODB_URI to a disposable wallet_test_* database" }, async (t) => {
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
  t.after(async () => { mock.restoreAll(); await mongoose.disconnect(); });

  // Transactions require a MongoDB replica set; ensure indexes are in place.
  await Promise.all([User.init(), WalletDeposit.init(), WalletTransaction.init()]);
  const unique = new mongoose.Types.ObjectId().toString();
  const amountCents = 2500;
  const providerOrderId = "ORD-TEST-" + unique;
  const providerPaymentId = "PAY-TEST-" + unique;
  const user = await User.create({
    name: "Wallet Test",
    email: "wallet-" + unique + "@example.invalid",
    isActive: true,
    wallet: { balanceCents: 1000 },
  });
  const deposit = await WalletDeposit.create({
    user: user._id, amountCents, provider: "mercadopago",
    status: "pending", providerOrderId,
  });

  t.after(async () => {
    await WalletTransaction.deleteMany({ deposit: deposit._id });
    await WalletDeposit.deleteOne({ _id: deposit._id });
    await User.deleteOne({ _id: user._id });
  });

  mock.method(MercadoPagoProvider, "getOrder", async () => ({
    orderId: providerOrderId,
    externalReference: String(deposit._id),
    normalizedStatus: "approved",
    payment: { id: providerPaymentId, method: "pix" },
    raw: {
      total_amount: "25.00",
      transactions: { payments: [{ id: providerPaymentId, amount: "25.00", payment_method: { id: "pix" } }] },
    },
  }));

  const attempts = await Promise.allSettled(
    Array.from({ length: 2 }, () => processApprovedMercadoPagoWalletDeposit({
      depositId: String(deposit._id), providerOrderId,
    }))
  );
  // A transaction may report a write conflict; a subsequent webhook retry must be harmless.
  const retry = await processApprovedMercadoPagoWalletDeposit({
    depositId: String(deposit._id), providerOrderId,
  });
  assert.equal(retry.processed, false);
  assert.equal(retry.reason, "ALREADY_PROCESSED");

  const [updatedUser, updatedDeposit, transactions] = await Promise.all([
    User.findById(user._id).lean(),
    WalletDeposit.findById(deposit._id).lean(),
    WalletTransaction.find({ deposit: deposit._id }).lean(),
  ]);
  assert.equal(updatedDeposit.status, "approved");
  assert.ok(updatedDeposit.processedAt);
  assert.equal(updatedUser.wallet.balanceCents, 3500);
  assert.equal(transactions.length, 1);
  assert.equal(transactions[0].amountCents, amountCents);
  assert.equal(transactions[0].balanceAfterCents, 3500);
  assert.ok(attempts.some((attempt) => attempt.status === "fulfilled" && attempt.value.processed));
});
