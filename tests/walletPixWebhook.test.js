import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { WebhookSignatureValidator } from "mercadopago";
import WalletDeposit from "../src/models/WalletDeposit.js";
import MercadoPagoProvider from "../src/services/payments/MercadoPagoProvider.js";
import { walletPixWebhook } from "../src/controllers/webhooks/WalletPixWebhookController.js";

const id = "507f1f77bcf86cd799439011";
const orderId = "ORD-TEST-WEBHOOK";
const makeRequest = (overrides = {}) => ({
  headers: { "x-signature": "signature", "x-request-id": "request-id" },
  query: { "data.id": orderId, type: "order" },
  body: {},
  ...overrides,
});
const makeResponse = () => ({
  code: null,
  sendStatus(code) { this.code = code; return this; },
});
const withSecret = (t) => {
  const previous = process.env.MERCADOPAGO_WEBHOOK_SECRET;
  process.env.MERCADOPAGO_WEBHOOK_SECRET = "test-secret";
  t.after(() => {
    mock.restoreAll();
    if (previous === undefined) delete process.env.MERCADOPAGO_WEBHOOK_SECRET;
    else process.env.MERCADOPAGO_WEBHOOK_SECRET = previous;
  });
};

test("webhook refuses requests without signature", async (t) => {
  withSecret(t);
  const provider = mock.method(MercadoPagoProvider, "getOrder", async () => {
    throw new Error("unexpected provider call");
  });
  const res = makeResponse();
  await walletPixWebhook(makeRequest({ headers: {} }), res);
  assert.equal(res.code, 401);
  assert.equal(provider.mock.callCount(), 0);
});

test("webhook refuses a rejected signature", async (t) => {
  withSecret(t);
  mock.method(WebhookSignatureValidator, "validate", () => {
    throw new Error("signature rejected");
  });
  const provider = mock.method(MercadoPagoProvider, "getOrder", async () => {
    throw new Error("unexpected provider call");
  });
  const res = makeResponse();
  await walletPixWebhook(makeRequest(), res);
  assert.equal(res.code, 500);
  assert.equal(provider.mock.callCount(), 0);
});

test("webhook ignores non-order events after signature validation", async (t) => {
  withSecret(t);
  mock.method(WebhookSignatureValidator, "validate", () => {});
  const provider = mock.method(MercadoPagoProvider, "getOrder", async () => {
    throw new Error("unexpected provider call");
  });
  const res = makeResponse();
  await walletPixWebhook(makeRequest({ query: { "data.id": orderId, type: "payment" } }), res);
  assert.equal(res.code, 200);
  assert.equal(provider.mock.callCount(), 0);
});

test("webhook leaves pending PIX uncredited", async (t) => {
  withSecret(t);
  mock.method(WebhookSignatureValidator, "validate", () => {});
  mock.method(MercadoPagoProvider, "getOrder", async () => ({
    orderId, externalReference: id, normalizedStatus: "pending",
  }));
  mock.method(WalletDeposit, "findOne", async () => ({
    _id: id, providerOrderId: orderId,
  }));
  const link = mock.method(WalletDeposit, "findOneAndUpdate", async () => ({
    _id: id, providerOrderId: orderId,
  }));
  const res = makeResponse();
  await walletPixWebhook(makeRequest(), res);
  assert.equal(res.code, 200);
  assert.equal(link.mock.callCount(), 1);
});
