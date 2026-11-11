import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import mongoose from 'mongoose';
import Auction from '../models/Auction.js';
import Product from '../models/Product.js';
import { processAuctionSchedules } from '../services/AuctionSchedulerService.js';
import { subscribeAuctionEvents } from '../services/AuctionEventsService.js';

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
function listener() {
  const req = new EventEmitter();
  const res = Object.assign(new EventEmitter(), {
    frames: [], destroyed: false, writableEnded: false,
    setHeader() {}, flushHeaders() {},
    write(frame) { this.frames.push(frame); return true; },
    end() { this.writableEnded = true; this.emit('close'); },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
  });
  return { req, res };
}
function events(res) {
  return res.frames.filter(frame => frame.startsWith('event: auction-update\n'))
    .map(frame => JSON.parse(frame.split('data: ')[1].trim()));
}

test('scheduler emits one activation and one finish event and keeps winner correct', {
  skip: !uri ? 'Set WALLET_TEST_MONGODB_URI' : false,
}, async () => {
  assert.ok(safe(uri), 'Unsafe MongoDB URI refused');
  const slug = 'scheduler-sse-' + randomUUID();
  let productId, auctionId;
  const { req, res } = listener();
  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
    const product = await Product.create({
      seller: new mongoose.Types.ObjectId(), slug,
      name: 'Produto de teste SSE', description: 'Temporario',
      price: 10, stock: 1,
    });
    productId = product._id;
    const winnerId = new mongoose.Types.ObjectId();
    const auction = await Auction.create({
      product: productId, status: 'scheduled', bidCostCents: 50,
      waitingStartedAt: new Date(Date.now() - 120_000),
      startsAt: new Date(Date.now() - 60_000),
    });
    auctionId = auction._id;
    subscribeAuctionEvents(req, res, auctionId);
    await processAuctionSchedules();
    await processAuctionSchedules();
    assert.equal((await Auction.findById(auctionId)).status, 'active');
    assert.deepEqual(events(res).map(e => e.status), ['active']);

    await Auction.updateOne({ _id: auctionId }, {
      $set: { bidCount: 1, currentPriceCents: 1,
        lastBidder: winnerId, endsAt: new Date(Date.now() - 1000) },
    });
    await processAuctionSchedules();
    await processAuctionSchedules();
    const final = await Auction.findById(auctionId);
    assert.equal(final.status, 'finished');
    assert.equal(String(final.winner), String(winnerId));
    assert.deepEqual(events(res).map(e => e.status), ['active', 'finished']);
    assert.equal(events(res)[1].bidCount, 1);
    assert.equal(events(res)[1].currentPriceCents, 1);
    assert.ok(!('winner' in events(res)[1]), 'Winner identity must not be broadcast');
  } finally {
    req.emit('close');
    if (auctionId) await Auction.deleteOne({ _id: auctionId });
    if (productId) await Product.deleteOne({ _id: productId, slug });
    await mongoose.disconnect();
  }
});
