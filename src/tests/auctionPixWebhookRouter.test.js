import test from "node:test";
import assert from "node:assert/strict";
import AuctionWinnerPayment from "../models/AuctionWinnerPayment.js";
import { routeAuctionPixWebhook } from "../services/AuctionPixWebhookRouter.js";

const id = "507f1f77bcf86cd799439011";
test("unrelated references never match auction PIX", async () => {
  assert.deepEqual(await routeAuctionPixWebhook({ externalReference: "commerce-123", providerOrderId: "ORD1" }), { matched: false });
});
test("known auction charge is isolated when feature flag is disabled", async () => {
  const previous = process.env.AUCTION_WINNER_PIX_WEBHOOK_ENABLED;
  const original = AuctionWinnerPayment.findById;
  try {
    delete process.env.AUCTION_WINNER_PIX_WEBHOOK_ENABLED;
    AuctionWinnerPayment.findById = async () => ({ _id: id, status: "pending", providerOrderId: "ORD1" });
    assert.deepEqual(await routeAuctionPixWebhook({ externalReference: id, providerOrderId: "ORD1" }), {
      matched: true, processed: false, reason: "FEATURE_DISABLED"
    });
  } finally {
    AuctionWinnerPayment.findById = original;
    if (previous === undefined) delete process.env.AUCTION_WINNER_PIX_WEBHOOK_ENABLED;
    else process.env.AUCTION_WINNER_PIX_WEBHOOK_ENABLED = previous;
  }
});
test("unknown object ID leaves existing payment routes untouched", async () => {
  const original = AuctionWinnerPayment.findById;
  try {
    AuctionWinnerPayment.findById = async () => null;
    assert.deepEqual(await routeAuctionPixWebhook({ externalReference: id, providerOrderId: "ORD1" }), { matched: false });
  } finally {
    AuctionWinnerPayment.findById = original;
  }
});
test("order mismatch cannot process a known auction payment", async () => {
  const previous = process.env.AUCTION_WINNER_PIX_WEBHOOK_ENABLED;
  const original = AuctionWinnerPayment.findById;
  try {
    process.env.AUCTION_WINNER_PIX_WEBHOOK_ENABLED = "true";
    AuctionWinnerPayment.findById = async () => ({ _id: id, status: "pending", providerOrderId: "ORD1" });
    assert.deepEqual(await routeAuctionPixWebhook({ externalReference: id, providerOrderId: "ORD2" }), {
      matched: true, processed: false, reason: "ORDER_MISMATCH"
    });
  } finally {
    AuctionWinnerPayment.findById = original;
    if (previous === undefined) delete process.env.AUCTION_WINNER_PIX_WEBHOOK_ENABLED;
    else process.env.AUCTION_WINNER_PIX_WEBHOOK_ENABLED = previous;
  }
});
