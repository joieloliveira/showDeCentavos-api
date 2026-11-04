import test from "node:test";
import assert from "node:assert/strict";
import { adaptMercadoPagoAuctionPixOrder } from "../services/AuctionPixProviderVerificationService.js";
import { validateAuctionPixConfirmation } from "../services/auctionPixConfirmationPolicy.js";

const id = "507f1f77bcf86cd799439011";
const auction = "507f191e810c19729de860ea";
const winner = "507f1f77bcf86cd799439012";
const fulfillmentId = "507f1f77bcf86cd799439013";
const payment = {
  _id: id, auction, winner, fulfillment: fulfillmentId,
  provider: "mercadopago", currency: "BRL", amountCents: 175,
  status: "pending", providerOrderId: "ORD123", processedAt: null,
};
const fulfillment = {
  _id: fulfillmentId, auction, winner, winningPriceCents: 175,
  paymentStatus: "pending",
};
function order(overrides = {}) {
  return {
    orderId: "ORD123", externalReference: id, normalizedStatus: "approved",
    payment: { id: "PAY123", method: "pix" },
    raw: { total_amount: "1.75", transactions: { payments: [{
      id: "PAY123", amount: "1.75", status: "processed",
      payment_method: { id: "pix" }
    }] } },
    ...overrides,
  };
}
test("real provider order contract maps to approved PIX policy", () => {
  const mapped = adaptMercadoPagoAuctionPixOrder(order());
  assert.equal(mapped.totalAmountCents, 175);
  assert.deepEqual(validateAuctionPixConfirmation({ payment, fulfillment, providerOrder: mapped }), { accepted: true });
});
test("provider decimal parsing rejects invalid and overprecision amounts", () => {
  for (const total_amount of ["1.751", "1e2", "-1.75", null, "1,75"]) {
    const mapped = adaptMercadoPagoAuctionPixOrder(order({
      raw: { ...order().raw, total_amount }
    }));
    assert.equal(validateAuctionPixConfirmation({ payment, fulfillment, providerOrder: mapped }).accepted, false);
  }
});
test("provider rejects multiple payments, mismatched transaction and non PIX", () => {
  const base = order();
  const variants = [
    { ...base, raw: { ...base.raw, transactions: { payments: [base.raw.transactions.payments[0], base.raw.transactions.payments[0]] } } },
    { ...base, raw: { ...base.raw, transactions: { payments: [{ ...base.raw.transactions.payments[0], amount: "2.00" }] } } },
    { ...base, payment: { id: "PAY999", method: "pix" } },
    { ...base, payment: { id: "PAY123", method: "credit_card" } },
    { ...base, raw: { ...base.raw, transactions: { payments: [{ ...base.raw.transactions.payments[0], status: "pending" }] } } },
  ];
  for (const variant of variants) {
    const mapped = adaptMercadoPagoAuctionPixOrder(variant);
    assert.equal(validateAuctionPixConfirmation({ payment, fulfillment, providerOrder: mapped }).accepted, false);
  }
});
