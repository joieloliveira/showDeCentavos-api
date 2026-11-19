import test from "node:test";
import assert from "node:assert/strict";
import { validateAuctionPixConfirmation as validate } from "../services/auctionPixConfirmationPolicy.js";

const payment = {
  _id: "payment-1", auction: "auction-1", fulfillment: "fulfillment-1",
  winner: "winner-1", amountCents: 175, currency: "BRL",
  provider: "mercadopago", providerOrderId: "order-1", status: "pending"
};
const fulfillment = {
  _id: "fulfillment-1", auction: "auction-1", winner: "winner-1",
  winningPriceCents: 175, paymentStatus: "pending"
};
const providerOrder = {
  orderId: "order-1", externalReference: "payment-1", normalizedStatus: "approved",
  totalAmountCents: 175, payment: { id: "pix-1", paymentMethodId: "pix" },
  transactions: [{ id: "pix-1", status: "approved", paymentMethodId: "pix", amountCents: 175 }]
};
const check = (changes = {}) => validate({
  payment: { ...payment, ...changes.payment },
  fulfillment: { ...fulfillment, ...changes.fulfillment },
  providerOrder: { ...providerOrder, ...changes.providerOrder }
});

test("accepts only fully matched approved PIX confirmation", () => {
  assert.deepEqual(check(), { accepted: true });
});
test("rejects duplicated or unexpected state", () => {
  assert.equal(check({ payment: { status: "paid", processedAt: new Date() } }).reason, "ALREADY_PROCESSED");
  assert.equal(check({ payment: { status: "not_started" } }).reason, "INVALID_STATE");
});
test("rejects cross-auction, cross-winner and mismatched references", () => {
  assert.equal(check({ payment: { winner: "other" } }).reason, "OWNER_MISMATCH");
  assert.equal(check({ payment: { auction: "other" } }).reason, "OWNER_MISMATCH");
  assert.equal(check({ providerOrder: { externalReference: "other" } }).reason, "REFERENCE_MISMATCH");
});
test("rejects invalid amount, status, payment method and missing transactions", () => {
  assert.equal(check({ providerOrder: { totalAmountCents: 176 } }).reason, "AMOUNT_MISMATCH");
  assert.equal(check({ payment: { amountCents: 176 } }).reason, "INVALID_AMOUNT");
  assert.equal(check({ providerOrder: { normalizedStatus: "pending" } }).reason, "UNVERIFIED_PIX");
  assert.equal(check({ providerOrder: { payment: { id: "pix-1", paymentMethodId: "card" } } }).reason, "UNVERIFIED_PIX");
  assert.equal(check({ providerOrder: { transactions: [] } }).reason, "UNVERIFIED_PIX");
});
