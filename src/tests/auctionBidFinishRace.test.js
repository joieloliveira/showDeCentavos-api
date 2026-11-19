import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mongoose from "mongoose";
import Auction from "../models/Auction.js";
import Bid from "../models/Bid.js";
import User from "../models/User.js";
import WalletTransaction from "../models/WalletTransaction.js";
import AuctionAuditEvent from "../models/AuctionAuditEvent.js";
import { placeBid } from "../controllers/bidController.js";
import { processAuctionSchedules } from "../services/AuctionSchedulerService.js";

const uri = process.env.WALLET_TEST_MONGODB_URI;
const safe = (() => {
  try {
    const u = new URL(uri);
    return ["127.0.0.1", "localhost"].includes(u.hostname) &&
      u.port === "27018" && u.pathname === "/wallet_test_pix" &&
      u.searchParams.get("replicaSet") === "walletTestRS";
  } catch { return false; }
})();

test("expired auction cannot charge concurrent bid while scheduler chooses last bidder", {
  skip: !safe && "Requires isolated MongoDB replica set",
}, async () => {
  const originalFlag = process.env.AUCTION_BIDDING_ENABLED;
  let user, auction;
  try {
    await mongoose.connect(uri.replace("/wallet_test_pix?", "/auction_finish_race_isolated?"), { serverSelectionTimeoutMS: 5000 });
    await Promise.all([Bid.init(), WalletTransaction.init(), User.init()]);
    user = await User.create({
      name: "Race Test User", email: "race-" + new mongoose.Types.ObjectId() + "@example.invalid",
      isActive: true, wallet: { balanceCents: 1000 },
    });
    auction = await Auction.create({
      product: new mongoose.Types.ObjectId(), bidCostCents: 50,
      status: "active", startsAt: new Date(Date.now() - 120000),
      endsAt: new Date(Date.now() - 30000), bidCount: 1,
      currentPriceCents: 1, lastBidder: user._id,
    });
    process.env.AUCTION_BIDDING_ENABLED = "true";
    const response = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
    await Promise.all([
      placeBid({ params: { id: String(auction._id) }, user: { id: String(user._id) }, body: { idempotencyKey: randomUUID() } }, response),
      processAuctionSchedules(),
    ]);
    const updated = await Auction.findById(auction._id);
    assert.equal(response.statusCode, 409, "expired bid must be rejected");
    assert.equal(updated.status, "finished");
    assert.equal(String(updated.winner), String(user._id));
    assert.equal(updated.bidCount, 1);
    assert.equal(updated.currentPriceCents, 1);
    assert.equal((await User.findById(user._id)).wallet.balanceCents, 1000);
    assert.equal(await Bid.countDocuments({ auction: auction._id }), 0);
    assert.equal(await WalletTransaction.countDocuments({ auction: auction._id }), 0);
    assert.equal(await AuctionAuditEvent.countDocuments({ auction: auction._id, eventType: "finished" }), 1);
    await processAuctionSchedules();
    assert.equal(await AuctionAuditEvent.countDocuments({ auction: auction._id, eventType: "finished" }), 1);
  } finally {
    if (originalFlag === undefined) delete process.env.AUCTION_BIDDING_ENABLED;
    else process.env.AUCTION_BIDDING_ENABLED = originalFlag;
    if (auction) {
      await AuctionAuditEvent.deleteMany({ auction: auction._id });
      await WalletTransaction.deleteMany({ auction: auction._id });
      await Bid.deleteMany({ auction: auction._id });
      await Auction.deleteOne({ _id: auction._id });
    }
    if (user) await User.deleteOne({ _id: user._id });
    await mongoose.disconnect();
  }
});
