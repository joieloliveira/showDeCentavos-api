import test from "node:test";
import assert from "node:assert/strict";
import { shouldIgnoreOrderWebhookState as ignore } from "../services/payments/orderWebhookStateGuard.js";

test("paid order ignores delayed pending, failed and cancelled events", () => {
  for (const status of ["pending", "failed", "cancelled"]) {
    assert.equal(ignore({ paymentStatus: "paid", payment: { processedAt: new Date() } }, status), true);
  }
});
test("refund is allowed after paid order", () => {
  assert.equal(ignore({ paymentStatus: "paid", payment: { processedAt: new Date() } }, "refunded"), false);
});
test("refunded order cannot return to paid or pending", () => {
  for (const status of ["approved", "pending", "failed", "cancelled"]) {
    assert.equal(ignore({ paymentStatus: "refunded" }, status), true);
  }
});
test("unsettled order still processes provider notifications", () => {
  for (const status of ["approved", "pending", "failed", "cancelled"]) {
    assert.equal(ignore({ paymentStatus: "pending" }, status), false);
  }
});
