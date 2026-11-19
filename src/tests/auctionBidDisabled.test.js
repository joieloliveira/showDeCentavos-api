import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import Auction from "../models/Auction.js";
import Bid from "../models/Bid.js";
import User from "../models/User.js";
import WalletTransaction from "../models/WalletTransaction.js";
import { placeBid } from "../controllers/bidController.js";

const uri = process.env.WALLET_TEST_MONGODB_URI;
const safe = (() => {
  try {
    const u = new URL(uri);
    return ["127.0.0.1", "localhost"].includes(u.hostname) &&
      u.port === "27018" && u.pathname === "/wallet_test_pix" &&
      u.searchParams.get("replicaSet") === "walletTestRS";
  } catch { return false; }
})();

test("financial bid release switch fails closed without any database writes", {
  skip: !safe && "Requires isolated MongoDB replica set",
}, async () => {
  const originalFlag = process.env.AUCTION_BIDDING_ENABLED;
  delete process.env.AUCTION_BIDDING_ENABLED;
  let auction, user;
  try {
    await mongoose.connect(uri.replace("/wallet_test_pix?", "/auction_bid_disabled_isolated?"), { serverSelectionTimeoutMS: 5000 });
    user = await User.create({
      name: "Bid Disabled", email: "bid-" + new mongoose.Types.ObjectId() + "@example.invalid",
      role: "customer", isActive: true, wallet: { balanceCents: 1000 },
    });
    auction = await Auction.create({
      product: new mongoose.Types.ObjectId(), bidCostCents: 50,
      status: "active", startsAt: new Date(Date.now() - 60000),
    });
    const req = { params: { id: String(auction._id) }, user: { id: String(user._id) }, body: { idempotencyKey: "8c47ad6b-07d7-49bb-9c2a-1c891df5045d" } };
    const response = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
    await placeBid(req, response);
    assert.equal(response.statusCode, 503);
    assert.equal((await User.findById(user._id)).wallet.balanceCents, 1000);
    assert.equal((await Auction.findById(auction._id)).bidCount, 0);
    assert.equal(await Bid.countDocuments({ auction: auction._id }), 0);
    assert.equal(await WalletTransaction.countDocuments({ auction: auction._id }), 0);
  } finally {
    if (auction) {
      await WalletTransaction.deleteMany({ auction: auction._id });
      await Bid.deleteMany({ auction: auction._id });
      await Auction.deleteOne({ _id: auction._id });
    }
    if (user) await User.deleteOne({ _id: user._id });
    await mongoose.disconnect();
    if (originalFlag === undefined) delete process.env.AUCTION_BIDDING_ENABLED;
    else process.env.AUCTION_BIDDING_ENABLED = originalFlag;
  }
});
