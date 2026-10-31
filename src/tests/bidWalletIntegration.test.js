import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import Product from '../models/Product.js';
import Auction from '../models/Auction.js';
import User from '../models/User.js';
import Bid from '../models/Bid.js';
import WalletTransaction from '../models/WalletTransaction.js';
import { placeBid } from '../controllers/bidController.js';

const uri = process.env.WALLET_TEST_MONGODB_URI;
function safe(value) {
  if (!value) return false;
  try {
    const u = new URL(value);
    return u.protocol === 'mongodb:' && u.hostname === '127.0.0.1' &&
      u.port === '27018' && u.pathname === '/wallet_test_pix' &&
      u.searchParams.get('replicaSet') === 'walletTestRS';
  } catch { return false; }
}
function response() {
  return { statusCode: 200, payload: null, status(code) { this.statusCode = code; return this; }, json(data) { this.payload = data; return this; } };
}
test('one bid debits wallet once and an idempotent retry preserves auction state', {
  skip: !uri ? 'Set WALLET_TEST_MONGODB_URI' : false,
}, async () => {
  assert.ok(safe(uri), 'Unsafe MongoDB URI refused');
  const suffix = randomUUID();
  const slug = 'bid-integration-' + suffix;
  let productId, auctionId, userId;
  const previousFlag = process.env.AUCTION_BIDDING_ENABLED;
  process.env.AUCTION_BIDDING_ENABLED = 'true';
  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
    await Bid.createCollection();
    await Bid.createIndexes();
    await WalletTransaction.createCollection();
    await WalletTransaction.createIndexes();
    const user = await User.create({ name: 'Usuario de teste', email: 'bid-' + suffix + '@example.invalid', wallet: { balanceCents: 200 }, isActive: true });
    userId = user._id;
    const product = await Product.create({ seller: userId, slug, name: 'Produto lance isolado', description: 'Teste temporario', price: 10, stock: 1 });
    productId = product._id;
    const auction = await Auction.create({
      product: productId, bidCostCents: 50, startPriceCents: 0,
      currentPriceCents: 0, bidCount: 0, status: 'active',
      startsAt: new Date(Date.now() - 60_000), endsAt: null,
    });
    auctionId = auction._id;
    const key = randomUUID();
    const req = { params: { id: String(auctionId) }, user: { id: String(userId) }, body: { idempotencyKey: key } };
    const first = response();
    await placeBid(req, first);
    assert.equal(first.statusCode, 201, JSON.stringify(first.payload));
    assert.equal(first.payload.balanceAfterCents, 150);
    assert.equal(first.payload.currentPriceCents, 1);
    assert.equal(first.payload.bidCount, 1);
    const retry = response();
    await placeBid(req, retry);
    assert.equal(retry.statusCode, 200, JSON.stringify(retry.payload));
    assert.equal(retry.payload.duplicate, true);
    const [savedUser, savedAuction, bids, ledger] = await Promise.all([
      User.findById(userId), Auction.findById(auctionId),
      Bid.find({ auction: auctionId }), WalletTransaction.find({ auction: auctionId }),
    ]);
    assert.equal(savedUser.wallet.balanceCents, 150);
    assert.equal(savedAuction.currentPriceCents, 1);
    assert.equal(savedAuction.bidCount, 1);
    assert.equal(String(savedAuction.lastBidder), String(userId));
    assert.ok(savedAuction.endsAt > new Date());
    assert.equal(bids.length, 1);
    assert.equal(ledger.length, 1);
    assert.equal(ledger[0].type, 'bid');
    assert.equal(ledger[0].amountCents, -50);
    assert.equal(ledger[0].balanceAfterCents, 150);
  } finally {
    if (auctionId) {
      await WalletTransaction.deleteMany({ auction: auctionId });
      await Bid.deleteMany({ auction: auctionId });
      await Auction.deleteOne({ _id: auctionId });
    }
    if (productId) await Product.deleteOne({ _id: productId, slug });
    if (userId) await User.deleteOne({ _id: userId });
    await mongoose.disconnect();
    if (previousFlag === undefined) delete process.env.AUCTION_BIDDING_ENABLED;
    else process.env.AUCTION_BIDDING_ENABLED = previousFlag;
  }
});
