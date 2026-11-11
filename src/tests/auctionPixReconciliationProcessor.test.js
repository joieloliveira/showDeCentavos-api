import test from "node:test";
import assert from "node:assert/strict";
import { reconcileVerifiedAuctionPix } from "../services/AuctionPixReconciliationProcessor.js";

test("reconciliation writes disabled by default", async () => {
  const previous = process.env.AUCTION_PIX_RECONCILIATION_WRITES_ENABLED;
  delete process.env.AUCTION_PIX_RECONCILIATION_WRITES_ENABLED;
  try {
    assert.deepEqual(await reconcileVerifiedAuctionPix({ paymentId: "invalid" }),
      { processed: false, reason: "FEATURE_DISABLED" });
  } finally {
    if (previous === undefined) delete process.env.AUCTION_PIX_RECONCILIATION_WRITES_ENABLED;
    else process.env.AUCTION_PIX_RECONCILIATION_WRITES_ENABLED = previous;
  }
});

test("enabled reconciliation rejects invalid payment IDs before DB access", async () => {
  const previous = process.env.AUCTION_PIX_RECONCILIATION_WRITES_ENABLED;
  process.env.AUCTION_PIX_RECONCILIATION_WRITES_ENABLED = "true";
  try {
    assert.deepEqual(await reconcileVerifiedAuctionPix({ paymentId: "invalid" }),
      { processed: false, reason: "INVALID_INPUT" });
  } finally {
    if (previous === undefined) delete process.env.AUCTION_PIX_RECONCILIATION_WRITES_ENABLED;
    else process.env.AUCTION_PIX_RECONCILIATION_WRITES_ENABLED = previous;
  }
});
