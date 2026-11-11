import test from "node:test";
import assert from "node:assert/strict";
import { planAuctionWinnerPixCharge } from "../services/auctionWinnerPixChargePolicy.js";

const now = new Date("2026-11-04T12:00:00Z");
function fixture() {
  const auction = { _id: "auction-1", winner: "winner-1", status: "finished",
    currentPriceCents: 175, endsAt: new Date("2026-11-04T11:00:00Z") };
  const fulfillment = { _id: "fulfillment-1", auction: auction._id,
    winner: auction.winner, winningPriceCents: 175, paymentStatus: "not_started" };
  return { auction, fulfillment, winnerId: auction.winner, now };
}
test("valid winner receives read-only PIX charge plan", () => {
  const result = planAuctionWinnerPixCharge(fixture());
  assert.equal(result.allowed, true);
  assert.equal(result.amountCents, 175);
  assert.equal(result.logicalChargeKey, "auction-winner-pix:auction-1");
  assert.equal(result.checkoutEnabled, false);
});
test("non-winner cannot plan charge", () => {
  assert.equal(planAuctionWinnerPixCharge({ ...fixture(), winnerId: "other" }).reason, "NOT_WINNER");
});
test("inconsistent winner fulfillment is blocked", () => {
  const input = fixture(); input.fulfillment.winner = "other";
  assert.equal(planAuctionWinnerPixCharge(input).reason, "INVALID_FULFILLMENT");
});
test("mismatched or zero auction amount is blocked", () => {
  const input = fixture(); input.fulfillment.winningPriceCents = 200;
  assert.equal(planAuctionWinnerPixCharge(input).reason, "AMOUNT_MISMATCH");
  const zero = fixture(); zero.auction.currentPriceCents = 0; zero.fulfillment.winningPriceCents = 0;
  assert.equal(planAuctionWinnerPixCharge(zero).reason, "AMOUNT_MISMATCH");
});
test("expired payment window is blocked", () => {
  assert.equal(planAuctionWinnerPixCharge({ ...fixture(), now: new Date("2026-11-07T12:00:00Z") }).reason, "PAYMENT_WINDOW_EXPIRED");
});
test("already paid fulfillment is blocked", () => {
  const input = fixture(); input.fulfillment.paymentStatus = "paid";
  assert.equal(planAuctionWinnerPixCharge(input).reason, "ALREADY_PAID");
});
test("existing pending provider charge cannot be recreated", () => {
  const input = fixture();
  const payment = { auction: "auction-1", fulfillment: "fulfillment-1", winner: "winner-1",
    amountCents: 175, currency: "BRL", provider: "mercadopago", status: "pending",
    providerOrderId: "MP-123" };
  assert.equal(planAuctionWinnerPixCharge({ ...input, payment }).reason, "EXISTING_CHARGE");
});
test("failed attempt requires manual reconciliation", () => {
  const input = fixture();
  const payment = { auction: "auction-1", fulfillment: "fulfillment-1", winner: "winner-1",
    amountCents: 175, currency: "BRL", provider: "mercadopago", status: "failed" };
  assert.equal(planAuctionWinnerPixCharge({ ...input, payment }).reason, "MANUAL_RECONCILIATION_REQUIRED");
});
test("payment linked to another winner is blocked", () => {
  const input = fixture();
  const payment = { auction: "auction-1", fulfillment: "fulfillment-1", winner: "other",
    amountCents: 175, currency: "BRL", provider: "mercadopago", status: "not_started" };
  assert.equal(planAuctionWinnerPixCharge({ ...input, payment }).reason, "PAYMENT_RECORD_MISMATCH");
});
