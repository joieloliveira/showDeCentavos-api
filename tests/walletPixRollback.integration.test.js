import assert from "node:assert/strict";
import test, { mock } from "node:test";
import mongoose from "mongoose";
import User from "../src/models/User.js";
import WalletDeposit from "../src/models/WalletDeposit.js";
import WalletTransaction from "../src/models/WalletTransaction.js";
import MercadoPagoProvider from "../src/services/payments/MercadoPagoProvider.js";
import { processApprovedMercadoPagoWalletDeposit } from "../src/services/MercadoPagoWalletDepositService.js";

// Explicit opt-in. Never use the application's default database.
const uri = process.env.WALLET_TEST_MONGODB_URI;
const databaseName = uri ? new URL(uri).pathname.replace(/^\//, "") : "";
const enabled = Boolean(uri && /^wallet_test_[a-z0-9_-]+$/i.test(databaseName));

test("failed ledger write rolls back deposit approval and wallet credit", {
  skip: !enabled && "Set WALLET_TEST_MONGODB_URI to a disposable wallet_test_* database",
}, async (t) => {
  let userId = null;
  let depositId = null;
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
  t.after(async () => {
    mock.restoreAll();
    try {
      if (depositId) {
        await WalletTransaction.deleteMany({ deposit: depositId });
        await WalletDeposit.deleteOne({ _id: depositId });
      }
      if (userId) await User.deleteOne({ _id: userId });
    } finally {
      await mongoose.disconnect();
    }
  });

  await Promise.all([User.init(), WalletDeposit.init(), WalletTransaction.init()]);
  const unique = new mongoose.Types.ObjectId().toString();
  const providerOrderId = "ROLLBACK-ORDER-" + unique;
  const providerPaymentId = "ROLLBACK-PAYMENT-" + unique;
  const user = await User.create({
    name: "Wallet Rollback Test",
    email: "wallet-rollback-" + unique + "@example.invalid",
    isActive: true,
    wallet: { balanceCents: 1000 },
  });
  userId = user._id;
  const deposit = await WalletDeposit.create({
    user: user._id, amountCents: 2500, provider: "mercadopago",
    status: "pending", providerOrderId,
  });
  depositId = deposit._id;

  mock.method(MercadoPagoProvider, "getOrder", async () => ({
    orderId: providerOrderId,
    externalReference: String(deposit._id),
    normalizedStatus: "approved",
    payment: { id: providerPaymentId, method: "pix" },
    raw: {
      total_amount: "25.00",
      transactions: {
        payments: [{ id: providerPaymentId, amount: "25.00", payment_method: { id: "pix" } }],
      },
    },
  }));

  const originalCreate = WalletTransaction.create;
  mock.method(WalletTransaction, "create", async () => {
    throw new Error("SIMULATED_LEDGER_FAILURE");
  });
  await assert.rejects(
    processApprovedMercadoPagoWalletDeposit({
      depositId: String(deposit._id), providerOrderId,
    }),
    /SIMULATED_LEDGER_FAILURE/
  );

  const [userAfterFailure, depositAfterFailure, ledgerAfterFailure] = await Promise.all([
    User.findById(user._id).lean(),
    WalletDeposit.findById(deposit._id).lean(),
    WalletTransaction.find({ deposit: deposit._id }).lean(),
  ]);
  assert.equal(userAfterFailure.wallet.balanceCents, 1000);
  assert.equal(depositAfterFailure.status, "pending");
  assert.equal(depositAfterFailure.processedAt, null);
  assert.equal(ledgerAfterFailure.length, 0);

  // Retry after restoring ledger writes must credit once, not lose the approved PIX.
  WalletTransaction.create = originalCreate;
  const retry = await processApprovedMercadoPagoWalletDeposit({
    depositId: String(deposit._id), providerOrderId,
  });
  assert.equal(retry.processed, true);

  const [userAfterRetry, depositAfterRetry, ledgerAfterRetry] = await Promise.all([
    User.findById(user._id).lean(),
    WalletDeposit.findById(deposit._id).lean(),
    WalletTransaction.find({ deposit: deposit._id }).lean(),
  ]);
  assert.equal(userAfterRetry.wallet.balanceCents, 3500);
  assert.equal(depositAfterRetry.status, "approved");
  assert.equal(ledgerAfterRetry.length, 1);
  assert.equal(ledgerAfterRetry[0].balanceAfterCents, 3500);
});
