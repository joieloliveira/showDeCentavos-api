import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import Auction from '../models/Auction.js';
import Product from '../models/Product.js';
import { processAuctionSchedules } from '../services/AuctionSchedulerService.js';

const uri = process.env.WALLET_TEST_MONGODB_URI;
function isSafeUri(value) {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'mongodb:' && url.hostname === '127.0.0.1' &&
      url.port === '27018' && url.pathname === '/wallet_test_pix' &&
      url.searchParams.get('replicaSet') === 'walletTestRS';
  } catch { return false; }
}

test('scheduler activates due auctions and finishes expired auctions exactly once', {
  skip: !uri ? 'Set WALLET_TEST_MONGODB_URI' : false,
}, async () => {
  assert.ok(isSafeUri(uri), 'Unsafe MongoDB URI refused');
  const slug = 'auction-scheduler-' + randomUUID();
  const seller = new mongoose.Types.ObjectId();
  const bidder = new mongoose.Types.ObjectId();
  let productId;
  let auctionIds = [];
  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
    const product = await Product.create({
      seller, slug, name: 'Produto scheduler isolado',
      description: 'Teste temporario', price: 10, stock: 1,
    });
    productId = product._id;
    const past = new Date(Date.now() - 60_000);
    const future = new Date(Date.now() + 60_000);
    const auctions = await Auction.create([
      { product: productId, status: 'scheduled', bidCostCents: 50, waitingStartedAt: past, startsAt: past },
      { product: productId, status: 'scheduled', bidCostCents: 50, waitingStartedAt: past, startsAt: future },
      { product: productId, status: 'active', bidCostCents: 50, bidCount: 1, lastBidder: bidder, startsAt: past, endsAt: past },
      { product: productId, status: 'active', bidCostCents: 50, bidCount: 0, startsAt: past, endsAt: null },
      { product: productId, status: 'active', bidCostCents: 50, bidCount: 1, lastBidder: bidder, startsAt: past, endsAt: future },
    ]);
    auctionIds = auctions.map(a => a._id);
    await processAuctionSchedules();
    const updated = await Auction.find({ _id: { $in: auctionIds } });
    const byId = new Map(updated.map(a => [String(a._id), a]));
    assert.equal(byId.get(String(auctionIds[0])).status, 'active');
    assert.equal(byId.get(String(auctionIds[1])).status, 'scheduled');
    assert.equal(byId.get(String(auctionIds[2])).status, 'finished');
    assert.equal(String(byId.get(String(auctionIds[2])).winner), String(bidder));
    assert.equal(byId.get(String(auctionIds[3])).status, 'active');
    assert.equal(byId.get(String(auctionIds[4])).status, 'active');
    await processAuctionSchedules();
    const finished = await Auction.findById(auctionIds[2]);
    assert.equal(finished.status, 'finished');
    assert.equal(String(finished.winner), String(bidder));
  } finally {
    if (auctionIds.length) await Auction.deleteMany({ _id: { $in: auctionIds } });
    if (productId) await Product.deleteOne({ _id: productId, slug });
    await mongoose.disconnect();
  }
});
