import test from "node:test";
import assert from "node:assert/strict";
import { auctionPaymentPreview } from "../services/auctionPaymentPreview.js";

const winner = "winner-fixture";
const finished = {
  _id: "auction-fixture",
  winner,
  status: "finished",
  endsAt: new Date("2026-11-01T12:00:00.000Z"),
  currentPriceCents: 175
};

test("payment preview response is read-only and does not expose payment credentials", () => {
  const result = auctionPaymentPreview({
    auction: finished,
    userId: winner,
    now: new Date("2026-11-02T12:00:00.000Z")
  });
  assert.equal(result.status, 200);
  assert.equal(result.data.checkoutEnabled, false);
  assert.equal(result.data.paymentWindowStatus, "awaiting_payment");
  assert.equal(result.data.amountCents, 175);
  assert.deepEqual(Object.keys(result.data).sort(), [
    "amountCents", "auctionId", "checkoutEnabled", "checkoutReason",
    "currency", "paymentDeadline", "paymentStatus", "paymentWindowStatus"
  ].sort());
});

test("preview cannot reveal a different winner's payment information", () => {
  const result = auctionPaymentPreview({
    auction: finished,
    userId: "other-user",
    now: new Date("2026-11-02T12:00:00.000Z")
  });
  assert.equal(result.status, 404);
  assert.equal(result.data, undefined);
});

test("paid and expired states cannot enable checkout", () => {
  for (const paymentStatus of ["paid", "pending", "failed", "refunded", "cancelled"]) {
    const result = auctionPaymentPreview({
      auction: finished,
      fulfillment: {
        auction: finished._id,
        winner,
        winningPriceCents: finished.currentPriceCents,
        paymentStatus
      },
      userId: winner,
      now: new Date("2026-11-05T12:00:00.000Z")
    });
    assert.equal(result.status, 200);
    assert.equal(result.data.checkoutEnabled, false);
    assert.equal(result.data.paymentStatus, paymentStatus);
  }
});
