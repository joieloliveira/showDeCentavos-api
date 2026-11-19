import test from "node:test";
import assert from "node:assert/strict";
import { calculatePaymentDeadline, paymentWindowState, canPrepareDelivery, canMarkDelivered } from "../services/auctionFulfillmentRules.js";

test("payment deadline is 48 hours after win by default", () => {
  assert.equal(calculatePaymentDeadline("2026-11-01T12:00:00.000Z").toISOString(), "2026-11-03T12:00:00.000Z");
});

test("payment remains awaiting at exact deadline and expires after it", () => {
  const wonAt = "2026-11-01T12:00:00.000Z";
  assert.equal(paymentWindowState({ wonAt, now: "2026-11-03T12:00:00.000Z" }), "awaiting_payment");
  assert.equal(paymentWindowState({ wonAt, now: "2026-11-03T12:00:00.001Z" }), "expired");
});

test("paid status is not overridden by expiration", () => {
  assert.equal(paymentWindowState({ wonAt: "2020-01-01", paymentStatus: "paid", now: "2026-11-02" }), "paid");
});

test("cancelled and refunded statuses are preserved", () => {
  assert.equal(paymentWindowState({ wonAt: "2020-01-01", paymentStatus: "cancelled" }), "cancelled");
  assert.equal(paymentWindowState({ wonAt: "2020-01-01", paymentStatus: "refunded" }), "refunded");
});

test("delivery preparation requires confirmed payment", () => {
  assert.equal(canPrepareDelivery({ paymentStatus: "pending", deliveryStatus: "not_started" }), false);
  assert.equal(canPrepareDelivery({ paymentStatus: "paid", deliveryStatus: "not_started" }), true);
  assert.equal(canPrepareDelivery({ paymentStatus: "paid", deliveryStatus: "shipped" }), false);
});

test("delivery completion requires shipment and confirmed payment", () => {
  assert.equal(canMarkDelivered({ paymentStatus: "paid", deliveryStatus: "shipped" }), true);
  assert.equal(canMarkDelivered({ paymentStatus: "paid", deliveryStatus: "preparing" }), false);
  assert.equal(canMarkDelivered({ paymentStatus: "pending", deliveryStatus: "shipped" }), false);
});

test("invalid dates and payment windows are rejected", () => {
  assert.throws(() => calculatePaymentDeadline("invalid"));
  assert.throws(() => calculatePaymentDeadline("2026-11-01", 0));
  assert.throws(() => calculatePaymentDeadline("2026-11-01", 721));
  assert.throws(() => paymentWindowState({ wonAt: "2026-11-01", now: "invalid" }));
});
