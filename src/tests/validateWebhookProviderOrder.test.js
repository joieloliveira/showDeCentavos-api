import test from "node:test";
import assert from "node:assert/strict";
import { validateWebhookProviderOrder } from "../services/payments/validateWebhookProviderOrder.js";

test("accepts only the provider order matching the signed notification", () => {
  assert.equal(validateWebhookProviderOrder({ orderId: "ORD-123" }, "ORD-123"), true);
  assert.equal(validateWebhookProviderOrder({ orderId: "ORD-999" }, "ORD-123"), false);
});
test("rejects unavailable or incomplete provider lookup", () => {
  assert.equal(validateWebhookProviderOrder(null, "ORD-123"), false);
  assert.equal(validateWebhookProviderOrder(undefined, "ORD-123"), false);
  assert.equal(validateWebhookProviderOrder({}, "ORD-123"), false);
});
test("does not accept a missing notification ID", () => {
  assert.equal(validateWebhookProviderOrder({ orderId: "ORD-123" }, undefined), false);
});
