import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import Auction from '../models/Auction.js';
import Product from '../models/Product.js';
import { processAuctionSchedules } from '../services/AuctionSchedulerService.js';

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

test('15-second countdown is authoritative in MongoDB and ends only through scheduler', {
  skip: !uri ? 'Set WALLET_TEST_MONGODB_URI' : false,
  timeout: 30000,
}, async () => {
  assert.ok(safe(uri), 'Unsafe MongoDB URI refused');
  const slug = 'countdown-15s-' + randomUUID();
  let productId, auctionId;
  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
    const product = await Product.create({
      seller: new mongoose.Types.ObjectId(), slug,
      name: 'Contagem de teste isolada', description: 'Temporario',
      price: 10, stock: 1,
    });
    productId = product._id;
    const lastBidder = new mongoose.Types.ObjectId();
    const deadline = new Date(Date.now() + 15_000);
    const auction = await Auction.create({
      product: productId, status: 'active', bidCostCents: 50,
      currentPriceCents: 1, bidCount: 1, lastBidder, endsAt: deadline,
      waitingStartedAt: new Date(), startsAt: new Date(),
    });
    auctionId = auction._id;
    assert.equal(auction.durationSeconds, 15);
    assert.equal(auction.status, 'active');
    assert.equal(auction.winner, null);
    assert.ok(auction.endsAt.getTime() > Date.now());

    // Do not invoke the global scheduler before expiry: it processes every
    // eligible auction in this isolated test DB, not just our fixture.
    const remaining = deadline.getTime() - Date.now();
    if (remaining > 0) await new Promise(resolve => setTimeout(resolve, remaining + 150));
    await processAuctionSchedules();
    const final = await Auction.findById(auctionId);
    assert.equal(final.status, 'finished');
    assert.equal(String(final.winner), String(lastBidder));
    assert.equal(final.currentPriceCents, 1);
    assert.equal(final.bidCount, 1);
  } finally {
    if (auctionId) await Auction.deleteOne({ _id: auctionId });
    if (productId) await Product.deleteOne({ _id: productId, slug });
    await mongoose.disconnect();
  }
});
