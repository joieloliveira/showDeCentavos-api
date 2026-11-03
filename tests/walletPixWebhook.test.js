import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { WebhookSignatureValidator, InvalidWebhookSignatureError } from "mercadopago";
import WalletDeposit from "../src/models/WalletDeposit.js";
import WalletPaymentIncident from "../src/models/WalletPaymentIncident.js";
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
    throw new InvalidWebhookSignatureError("signature rejected");
  });
  const provider = mock.method(MercadoPagoProvider, "getOrder", async () => {
    throw new Error("unexpected provider call");
  });
  const res = makeResponse();
  await walletPixWebhook(makeRequest(), res);
  assert.equal(res.code, 401);
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


test("webhook rejects a provider response for a different order", async (t) => {
  withSecret(t);
  mock.method(WebhookSignatureValidator, "validate", () => {});
  mock.method(MercadoPagoProvider, "getOrder", async () => ({
    orderId: "ORD-DIFFERENT", externalReference: id, normalizedStatus: "approved",
  }));
  const lookup = mock.method(WalletDeposit, "findOne", async () => {
    throw new Error("unexpected deposit lookup");
  });
  const res = makeResponse();
  await walletPixWebhook(makeRequest(), res);
  assert.equal(res.code, 500);
  assert.equal(lookup.mock.callCount(), 0);
});

test("refund webhook creates an incident for manual review", async (t) => {
  withSecret(t);
  mock.method(WebhookSignatureValidator, "validate", () => {});
  mock.method(MercadoPagoProvider, "getOrder", async () => ({
    orderId, externalReference: id, normalizedStatus: "refunded",
  }));
  mock.method(WalletDeposit, "findOne", async () => ({
    _id: id, user: "507f1f77bcf86cd799439012",
    provider: "mercadopago", providerOrderId: orderId,
  }));
  mock.method(WalletDeposit, "findOneAndUpdate", async () => ({
    _id: id, user: "507f1f77bcf86cd799439012",
    provider: "mercadopago", providerOrderId: orderId,
  }));
  const incident = mock.method(WalletPaymentIncident, "findOneAndUpdate", async (filter, changes) => {
    assert.equal(filter.providerStatus, "refunded");
    assert.equal(changes.$setOnInsert.resolution, "review_required");
    return { ...filter };
  });
  const res = makeResponse();
  await walletPixWebhook(makeRequest(), res);
  assert.equal(res.code, 200);
  assert.equal(incident.mock.callCount(), 1);
});
