import test from "node:test";
import assert from "node:assert/strict";
import { canCancelReservedOrder } from "../services/payments/orderWebhookStateGuard.js";

test("pending unpaid order may release reservation", () => {
  assert.equal(canCancelReservedOrder({ paymentStatus: "pending", payment: { processedAt: null } }), true);
});
test("paid and refunded orders cannot release reservation through cancellation", () => {
  for (const status of ["paid", "refunded"]) {
    assert.equal(canCancelReservedOrder({ paymentStatus: status, payment: {} }), false);
  }
});
test("processed payment cannot be cancelled even with stale pending status", () => {
  assert.equal(canCancelReservedOrder({ paymentStatus: "pending", payment: { processedAt: new Date() } }), false);
});
test("missing order cannot release reservation", () => {
  assert.equal(canCancelReservedOrder(null), false);
});
