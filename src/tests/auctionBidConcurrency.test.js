import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mongoose from "mongoose";
import Auction from "../models/Auction.js";
import Bid from "../models/Bid.js";
import User from "../models/User.js";
import WalletTransaction from "../models/WalletTransaction.js";
import { placeBid } from "../controllers/bidController.js";

const uri = process.env.WALLET_TEST_MONGODB_URI;
const isolated = (() => {
  try {
    const u = new URL(uri);
    return ["localhost", "127.0.0.1"].includes(u.hostname) &&
      u.port === "27018" && u.pathname === "/wallet_test_pix" &&
      u.searchParams.get("replicaSet") === "walletTestRS";
  } catch { return false; }
})();

test("concurrent bids never create unbacked charges or duplicate idempotency keys", {
  skip: !isolated && "Requires isolated MongoDB replica set",
}, async () => {
  const originalFlag = process.env.AUCTION_BIDDING_ENABLED;
  let user, auction;
  try {
    await mongoose.connect(uri.replace("/wallet_test_pix?", "/auction_bid_concurrency_isolated?"), { serverSelectionTimeoutMS: 5000 });
    await Promise.all([Bid.init(), WalletTransaction.init(), User.init()]);
    user = await User.create({
      name: "Concorrencia Lances", email: "bid-" + new mongoose.Types.ObjectId() + "@example.invalid",
      role: "customer", isActive: true, wallet: { balanceCents: 1000 },
    });
    auction = await Auction.create({
      product: new mongoose.Types.ObjectId(), bidCostCents: 50,
      status: "active", startsAt: new Date(Date.now() - 60000),
    });
    process.env.AUCTION_BIDDING_ENABLED = "true";
    const request = async key => {
      const response = {
        statusCode: 200,
        status(code) { this.statusCode = code; return this; },
        json(body) { this.body = body; return this; },
      };
      await placeBid({
        params: { id: String(auction._id) }, user: { id: String(user._id) },
        body: { idempotencyKey: key },
      }, response);
      return response;
    };
    const sharedKey = randomUUID();
    const firstWave = await Promise.all(Array.from({ length: 6 }, () => request(sharedKey)));
    assert.ok(firstWave.some(r => r.statusCode === 201), "one shared-key bid must succeed");
    assert.ok(firstWave.every(r => [200, 201, 409].includes(r.statusCode)), "unexpected shared-key response");
    assert.equal(await Bid.countDocuments({ auction: auction._id }), 1);
    assert.equal(await WalletTransaction.countDocuments({ auction: auction._id, type: "bid" }), 1);
    assert.equal((await User.findById(user._id)).wallet.balanceCents, 950);
    const secondWave = await Promise.all(Array.from({ length: 6 }, () => request(randomUUID())));
    assert.ok(secondWave.every(r => [201, 409].includes(r.statusCode)), "unexpected distinct-key response");
    const bids = await Bid.find({ auction: auction._id }).lean();
    const ledger = await WalletTransaction.find({ auction: auction._id, type: "bid" }).lean();
    const updatedAuction = await Auction.findById(auction._id).lean();
    const updatedUser = await User.findById(user._id).lean();
    const successfulDistinct = secondWave.filter(r => r.statusCode === 201).length;
    assert.equal(bids.length, 1 + successfulDistinct);
    assert.equal(ledger.length, bids.length);
    assert.equal(updatedAuction.bidCount, bids.length);
    assert.equal(updatedAuction.currentPriceCents, bids.length);
    assert.equal(updatedUser.wallet.balanceCents, 1000 - bids.length * 50);
    assert.ok(updatedUser.wallet.balanceCents >= 0);
    assert.equal(new Set(bids.map(b => b.idempotencyKey)).size, bids.length);
    for (const bid of bids) {
      const tx = ledger.filter(t => String(t.bid) === String(bid._id));
      assert.equal(tx.length, 1);
      assert.equal(tx[0].amountCents, -bid.bidCostCents);
      assert.equal(tx[0].balanceAfterCents, bid.balanceAfterCents);
    }
  } finally {
    if (originalFlag === undefined) delete process.env.AUCTION_BIDDING_ENABLED;
    else process.env.AUCTION_BIDDING_ENABLED = originalFlag;
    if (auction) {
      await WalletTransaction.deleteMany({ auction: auction._id });
      await Bid.deleteMany({ auction: auction._id });
      await Auction.deleteOne({ _id: auction._id });
    }
    if (user) await User.deleteOne({ _id: user._id });
    await mongoose.disconnect();
  }
});
