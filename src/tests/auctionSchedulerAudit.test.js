import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import Auction from "../models/Auction.js";
import AuctionAuditEvent from "../models/AuctionAuditEvent.js";
import { processAuctionSchedules } from "../services/AuctionSchedulerService.js";

const uri = process.env.WALLET_TEST_MONGODB_URI;
const allowed = (() => {
  try {
    const url = new URL(uri);
    return ["127.0.0.1", "localhost"].includes(url.hostname)
      && url.port === "27018"
      && url.pathname === "/wallet_test_pix"
      && url.searchParams.get("replicaSet") === "walletTestRS";
  } catch { return false; }
})();

test("scheduler transitions create audit records once in a dedicated test database", {
  skip: !allowed && "Requires isolated local wallet test replica set",
}, async () => {
  // Separate database ensures the scheduler cannot update any other test fixtures.
  const isolatedUri = uri.replace("/wallet_test_pix?", "/auction_scheduler_audit_isolated?");
  await mongoose.connect(isolatedUri, { serverSelectionTimeoutMS: 5000 });
  const product = new mongoose.Types.ObjectId();
  const bidder = new mongoose.Types.ObjectId();
  const past = new Date(Date.now() - 120000);
  let auction;
  try {
    auction = await Auction.create({
      product, startPriceCents: 0, currentPriceCents: 1, bidCostCents: 50,
      bidCount: 1, lastBidder: bidder, waitingStartedAt: past,
      startsAt: new Date(past.getTime() + 60000), endsAt: new Date(Date.now() - 1000),
      status: "scheduled",
    });
    await processAuctionSchedules();
    await processAuctionSchedules();
    const updated = await Auction.findById(auction._id).lean();
    assert.equal(updated.status, "finished");
    assert.equal(String(updated.winner), String(bidder));
    const events = await AuctionAuditEvent.find({ auction: auction._id }).sort({ occurredAt: 1 }).lean();
    assert.deepEqual(events.map(event => event.eventType), ["activated", "finished"]);
    assert.ok(events.every(event => event.source === "scheduler"));
  } finally {
    if (auction) {
      await AuctionAuditEvent.deleteMany({ auction: auction._id });
      await Auction.deleteOne({ _id: auction._id });
    }
    await mongoose.disconnect();
  }
});
