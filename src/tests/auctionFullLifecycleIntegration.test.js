import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mongoose from "mongoose";
import Auction from "../models/Auction.js";
import Bid from "../models/Bid.js";
import User from "../models/User.js";
import WalletTransaction from "../models/WalletTransaction.js";
import AuctionAuditEvent from "../models/AuctionAuditEvent.js";
import { processAuctionSchedules } from "../services/AuctionSchedulerService.js";
import { placeBid } from "../controllers/bidController.js";

const uri = process.env.WALLET_TEST_MONGODB_URI || "";
function safeUri(value) {
  try {
    const u = new URL(value);
    return u.protocol === "mongodb:" && u.hostname === "127.0.0.1" &&
      u.port === "27018" && u.pathname === "/wallet_test_pix" &&
      u.searchParams.get("replicaSet") === "walletTestRS";
  } catch { return false; }
}
function response() {
  return { statusCode: 200, status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; } };
}

test("complete auction lifecycle: activate, bid, debit, finish and reconcile winner", {
  skip: !safeUri(uri) && "Requires isolated local MongoDB replica set",
  timeout: 30000,
}, async () => {
  const oldFlag = process.env.AUCTION_BIDDING_ENABLED;
  let connected = false;
  try {
    await mongoose.connect(uri, {
      dbName: `auction_lifecycle_${process.pid}_${Date.now()}`,
      serverSelectionTimeoutMS: 5000,
    });
    connected = true;
    await Promise.all([Bid.createIndexes(), WalletTransaction.createIndexes(), AuctionAuditEvent.createIndexes()]);
    const user = await User.create({
      name: "Lifecycle test", email: `lifecycle-${randomUUID()}@example.invalid`,
      isActive: true, wallet: { balanceCents: 200 },
    });
    const past = new Date(Date.now() - 60000);
    const auction = await Auction.create({
      product: new mongoose.Types.ObjectId(), bidCostCents: 50,
      status: "scheduled", waitingStartedAt: past, startsAt: past,
      currentPriceCents: 0, startPriceCents: 0,
    });

    await processAuctionSchedules();
    assert.equal((await Auction.findById(auction._id)).status, "active");
    process.env.AUCTION_BIDDING_ENABLED = "true";
    const idempotencyKey = randomUUID();
    const req = { params: { id: String(auction._id) }, user: { id: String(user._id) },
      body: { idempotencyKey } };
    const first = response();
    await placeBid(req, first);
    assert.equal(first.statusCode, 201, JSON.stringify(first.body));
    assert.equal(first.body.bidCount, 1);
    assert.equal(first.body.currentPriceCents, 1);

    const replay = response();
    await placeBid(req, replay);
    assert.equal(replay.statusCode, 200);
    assert.equal(replay.body.duplicate, true);
    assert.equal((await User.findById(user._id)).wallet.balanceCents, 150);
    assert.equal(await Bid.countDocuments({ auction: auction._id }), 1);
    const ledger = await WalletTransaction.find({ auction: auction._id, type: "bid" }).lean();
    assert.equal(ledger.length, 1);
    assert.equal(ledger[0].amountCents, -50);
    assert.equal(ledger[0].balanceAfterCents, 150);

    // Simulate time passing without waiting 15 seconds; only the scheduler
    // may finalize the winner. No second bid is allowed after expiry.
    await Auction.updateOne({ _id: auction._id }, { $set: { endsAt: new Date(Date.now() - 1000) } });
    const late = response();
    await placeBid({ ...req, body: { idempotencyKey: randomUUID() } }, late);
    assert.equal(late.statusCode, 409);
    await processAuctionSchedules();
    await processAuctionSchedules();
    const finished = await Auction.findById(auction._id).lean();
    assert.equal(finished.status, "finished");
    assert.equal(String(finished.winner), String(user._id));
    assert.equal(finished.currentPriceCents, 1);
    assert.equal(finished.bidCount, 1);
    assert.equal((await User.findById(user._id)).wallet.balanceCents, 150);
    assert.equal(await WalletTransaction.countDocuments({ auction: auction._id, type: "bid" }), 1);
    const events = await AuctionAuditEvent.find({ auction: auction._id }).lean();
    assert.deepEqual(events.map(e => e.eventType).sort(), ["activated", "finished"]);
  } finally {
    if (oldFlag === undefined) delete process.env.AUCTION_BIDDING_ENABLED;
    else process.env.AUCTION_BIDDING_ENABLED = oldFlag;
    if (connected) {
      await mongoose.connection.dropDatabase();
      await mongoose.disconnect();
    }
  }
});
