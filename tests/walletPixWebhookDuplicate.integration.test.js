import assert from "node:assert/strict";
import test, { mock } from "node:test";
import mongoose from "mongoose";
import User from "../src/models/User.js";
import WalletDeposit from "../src/models/WalletDeposit.js";
import WalletTransaction from "../src/models/WalletTransaction.js";
import MercadoPagoProvider from "../src/services/payments/MercadoPagoProvider.js";
import { WebhookSignatureValidator } from "mercadopago";
import { walletPixWebhook } from "../src/controllers/webhooks/WalletPixWebhookController.js";

const uri = process.env.WALLET_TEST_MONGODB_URI;
const dbName = uri ? new URL(uri).pathname.replace(/^\//, "") : "";
const enabled = Boolean(uri && /^wallet_test_[a-z0-9_-]+$/i.test(dbName));

test("duplicate approved PIX webhooks credit the wallet once", {
  skip: !enabled && "Set WALLET_TEST_MONGODB_URI to a disposable wallet_test_* database",
}, async (t) => {
  let userId = null;
  let depositId = null;
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
  t.after(async () => {
    mock.restoreAll();
    if (previousSecret === undefined) delete process.env.MERCADOPAGO_WEBHOOK_SECRET;
    else process.env.MERCADOPAGO_WEBHOOK_SECRET = previousSecret;
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
  const previousSecret = process.env.MERCADOPAGO_WEBHOOK_SECRET;
  process.env.MERCADOPAGO_WEBHOOK_SECRET = "test-secret";
  await Promise.all([User.init(), WalletDeposit.init(), WalletTransaction.init()]);
  const unique = new mongoose.Types.ObjectId().toString();
  const orderId = "WEBHOOK-ORDER-" + unique;
  const paymentId = "WEBHOOK-PAYMENT-" + unique;
  const user = await User.create({
    name: "Webhook Duplicate Test",
    email: "webhook-duplicate-" + unique + "@example.invalid",
    wallet: { balanceCents: 1000 },
  });
  userId = user._id;
  const deposit = await WalletDeposit.create({
    user: user._id,
    amountCents: 2500,
    provider: "mercadopago",
    status: "pending",
    providerOrderId: orderId,
  });
  depositId = deposit._id;
  mock.method(WebhookSignatureValidator, "validate", () => {});
  mock.method(MercadoPagoProvider, "getOrder", async () => ({
    orderId,
    externalReference: String(deposit._id),
    normalizedStatus: "approved",
    payment: { id: paymentId, method: "pix" },
    raw: {
      total_amount: "25.00",
      transactions: { payments: [{ id: paymentId, amount: "25.00", payment_method: { id: "pix" } }] },
    },
  }));
  const makeRes = () => ({
    statusCode: null,
    sendStatus(code) { this.statusCode = code; return this; },
  });
  const makeReq = () => ({
    query: { "data.id": orderId, type: "order" },
    body: {},
    headers: { "x-signature": "test-signature", "x-request-id": "test-request" },
  });
  // Sequential delivery is the common retry path. Concurrent credits are
  // independently covered by walletPixConcurrency.integration.test.js.
  const first = makeRes();
  await walletPixWebhook(makeReq(), first);
  const second = makeRes();
  await walletPixWebhook(makeReq(), second);
  assert.equal(first.statusCode, 200);
  assert.equal(second.statusCode, 200);
  const [updatedUser, updatedDeposit, entries] = await Promise.all([
    User.findById(user._id).lean(),
    WalletDeposit.findById(deposit._id).lean(),
    WalletTransaction.find({ deposit: deposit._id }).lean(),
  ]);
  assert.equal(updatedUser.wallet.balanceCents, 3500);
  assert.equal(updatedDeposit.status, "approved");
  assert.equal(entries.length, 1);
  assert.equal(entries[0].amountCents, 2500);
});
