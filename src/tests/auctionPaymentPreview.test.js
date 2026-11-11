import test from "node:test";
import assert from "node:assert/strict";
import { auctionPaymentPreview } from "../services/auctionPaymentPreview.js";

const winner = "user-1";
const auction = {
  _id: "auction-1", winner, status: "finished",
  currentPriceCents: 175, endsAt: new Date("2026-11-01T12:00:00.000Z")
};
const now = new Date("2026-11-02T12:00:00.000Z");
test("winner sees amount, deadline and disabled checkout without side effects", () => {
  const result = auctionPaymentPreview({ auction, userId: winner, now });
  assert.equal(result.status, 200);
  assert.equal(result.data.amountCents, 175);
  assert.equal(result.data.currency, "BRL");
  assert.equal(result.data.paymentDeadline.toISOString(), "2026-11-03T12:00:00.000Z");
  assert.equal(result.data.paymentWindowStatus, "awaiting_payment");
  assert.equal(result.data.checkoutEnabled, false);
});
test("nonwinner and unfinished auctions are not disclosed", () => {
  assert.equal(auctionPaymentPreview({ auction, userId: "someone-else", now }).status, 404);
  assert.equal(auctionPaymentPreview({ auction: { ...auction, status: "active" }, userId: winner, now }).status, 404);
});
test("expired and paid previews preserve correct states without charging", () => {
  const expired = auctionPaymentPreview({ auction, userId: winner, now: new Date("2026-11-04T12:00:00Z") });
  assert.equal(expired.data.paymentWindowStatus, "expired");
  const paid = auctionPaymentPreview({
    auction, userId: winner, now: new Date("2026-11-04T12:00:00Z"),
    fulfillment: { auction: auction._id, winner, winningPriceCents: 175, paymentStatus: "paid" }
  });
  assert.equal(paid.data.paymentWindowStatus, "paid");
  assert.equal(paid.data.checkoutEnabled, false);
});
test("inconsistent fulfillment and invalid auction price fail closed", () => {
  assert.equal(auctionPaymentPreview({
    auction, userId: winner,
    fulfillment: { auction: auction._id, winner: "another", winningPriceCents: 175 }
  }).status, 409);
  assert.equal(auctionPaymentPreview({
    auction, userId: winner,
    fulfillment: { auction: auction._id, winner, winningPriceCents: 200 }
  }).status, 409);
  assert.equal(auctionPaymentPreview({ auction: { ...auction, currentPriceCents: -1 }, userId: winner }).status, 409);
});
