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
const safe = (value) => {
  if (!value) return false;
  try {
    const u = new URL(value);
    return u.protocol === 'mongodb:' && u.hostname === '127.0.0.1' &&
      u.port === '27018' && u.pathname === '/wallet_test_pix' &&
      u.searchParams.get('replicaSet') === 'walletTestRS';
  } catch { return false; }
};
const response = () => ({
  statusCode: 200, payload: null,
  status(code) { this.statusCode = code; return this; },
  json(value) { this.payload = value; return this; },
});

test('simultaneous bids never cause an unrecorded debit or lost price increment', {
  skip: !uri ? 'Set WALLET_TEST_MONGODB_URI' : false,
}, async () => {
  assert.ok(safe(uri), 'Unsafe MongoDB URI refused');
  const previous = process.env.AUCTION_BIDDING_ENABLED;
  process.env.AUCTION_BIDDING_ENABLED = 'true';
  const suffix = randomUUID();
  let productId, auctionId;
  const userIds = [];
  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
    await Bid.createCollection();
    await Bid.createIndexes();
    await WalletTransaction.createCollection();
    await WalletTransaction.createIndexes();
    const users = await User.create([
      { name: 'Participante A', email: 'concurrent-a-' + suffix + '@example.invalid', wallet: { balanceCents: 200 } },
      { name: 'Participante B', email: 'concurrent-b-' + suffix + '@example.invalid', wallet: { balanceCents: 200 } },
    ]);
    userIds.push(...users.map(u => u._id));
    const product = await Product.create({
      seller: userIds[0], slug: 'bid-concurrency-' + suffix,
      name: 'Produto concorrencia isolado', description: 'Teste temporario', price: 10, stock: 1,
    });
    productId = product._id;
    const auction = await Auction.create({
      product: productId, status: 'active', bidCostCents: 50,
      startsAt: new Date(Date.now() - 60_000), endsAt: null,
    });
    auctionId = auction._id;
    const responses = [response(), response()];
    await Promise.all(users.map((user, i) => placeBid({
      params: { id: String(auctionId) },
      user: { id: String(user._id) },
      body: { idempotencyKey: randomUUID() },
    }, responses[i])));
    const [savedAuction, savedUsers, bids, ledger] = await Promise.all([
      Auction.findById(auctionId),
      User.find({ _id: { $in: userIds } }),
      Bid.find({ auction: auctionId }),
      WalletTransaction.find({ auction: auctionId }),
    ]);
    const successes = responses.filter(r => r.statusCode === 201).length;
    assert.ok(successes >= 1 && successes <= 2, JSON.stringify(responses));
    assert.equal(bids.length, successes);
    assert.equal(ledger.length, successes);
    assert.equal(savedAuction.bidCount, successes);
    assert.equal(savedAuction.currentPriceCents, successes);
    assert.equal(savedUsers.reduce((total, u) => total + u.wallet.balanceCents, 0), 400 - 50 * successes);
    assert.equal(ledger.reduce((total, entry) => total + entry.amountCents, 0), -50 * successes);
    assert.ok(ledger.every(entry => entry.type === 'bid' && entry.bid));
    assert.ok(responses.every(r => [201, 409, 503].includes(r.statusCode)), JSON.stringify(responses));
  } finally {
    if (auctionId) {
      await WalletTransaction.deleteMany({ auction: auctionId });
      await Bid.deleteMany({ auction: auctionId });
      await Auction.deleteOne({ _id: auctionId });
    }
    if (productId) await Product.deleteOne({ _id: productId });
    if (userIds.length) await User.deleteMany({ _id: { $in: userIds } });
    await mongoose.disconnect();
    if (previous === undefined) delete process.env.AUCTION_BIDDING_ENABLED;
    else process.env.AUCTION_BIDDING_ENABLED = previous;
  }
});
