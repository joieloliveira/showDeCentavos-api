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

test("failed bid ledger insert rolls back wallet debit, bid and auction increment", {
  skip: !isolated && "Requires isolated MongoDB replica set",
}, async () => {
  const originalFlag = process.env.AUCTION_BIDDING_ENABLED;
  const originalCreate = WalletTransaction.create;
  let user, auction;
  try {
    await mongoose.connect(uri.replace("/wallet_test_pix?", "/auction_bid_rollback_isolated?"), { serverSelectionTimeoutMS: 5000 });
    await Promise.all([Bid.init(), WalletTransaction.init(), User.init()]);
    user = await User.create({
      name: "Rollback Lance", email: "bid-" + new mongoose.Types.ObjectId() + "@example.invalid",
      role: "customer", isActive: true, wallet: { balanceCents: 1000 },
    });
    auction = await Auction.create({
      product: new mongoose.Types.ObjectId(), bidCostCents: 50,
      status: "active", startsAt: new Date(Date.now() - 60000),
    });
    process.env.AUCTION_BIDDING_ENABLED = "true";
    let failOnce = true;
    WalletTransaction.create = async function (...args) {
      if (failOnce) {
        failOnce = false;
        throw new Error("SIMULATED_BID_LEDGER_WRITE_FAILURE");
      }
      return originalCreate.apply(this, args);
    };
    const invoke = async key => {
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
    const key = randomUUID();
    const failed = await invoke(key);
    assert.notEqual(failed.statusCode, 201, "a failed ledger write must not confirm a bid");
    assert.equal((await User.findById(user._id)).wallet.balanceCents, 1000);
    let state = await Auction.findById(auction._id);
    assert.equal(state.bidCount, 0);
    assert.equal(state.currentPriceCents, 0);
    assert.equal(state.lastBidder, null);
    assert.equal(state.endsAt, null);
    assert.equal(await Bid.countDocuments({ auction: auction._id }), 0);
    assert.equal(await WalletTransaction.countDocuments({ auction: auction._id }), 0);
    WalletTransaction.create = originalCreate;
    const retried = await invoke(key);
    assert.equal(retried.statusCode, 201, "same key should work after a fully rolled-back failure");
    assert.equal((await User.findById(user._id)).wallet.balanceCents, 950);
    state = await Auction.findById(auction._id);
    assert.equal(state.bidCount, 1);
    assert.equal(state.currentPriceCents, 1);
    assert.equal(await Bid.countDocuments({ auction: auction._id }), 1);
    assert.equal(await WalletTransaction.countDocuments({ auction: auction._id, type: "bid" }), 1);
  } finally {
    WalletTransaction.create = originalCreate;
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
