import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import Product from '../models/Product.js';
import Auction from '../models/Auction.js';
import { getAuctionLiveState } from '../controllers/auctionController.js';

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
  return {
    statusCode: 200, headers: {}, payload: null,
    status(code) { this.statusCode = code; return this; },
    set(name, value) { this.headers[name] = value; return this; },
    json(value) { this.payload = value; return this; },
  };
}
test('live snapshot reflects auction changes without exposing user or product details', {
  skip: !uri ? 'Set WALLET_TEST_MONGODB_URI' : false,
}, async () => {
  assert.ok(safe(uri), 'Unsafe MongoDB URI refused');
  const slug = 'auction-live-' + randomUUID();
  let productId, auctionId;
  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
    const product = await Product.create({
      seller: new mongoose.Types.ObjectId(), slug,
      name: 'Produto live isolado', description: 'Nao deve ser exposto',
      price: 10, stock: 1,
    });
    productId = product._id;
    const auction = await Auction.create({
      product: productId, status: 'scheduled', bidCostCents: 50,
      currentPriceCents: 0, bidCount: 0,
    });
    auctionId = auction._id;
    const req = { params: { id: String(auctionId) } };
    const first = response();
    await getAuctionLiveState(req, first);
    assert.equal(first.statusCode, 200);
    assert.equal(first.payload.auction.status, 'scheduled');
    assert.equal(first.payload.auction.bidCount, 0);
    assert.equal(first.headers['Cache-Control'], 'no-store');
    assert.ok(!('product' in first.payload.auction));
    assert.ok(!('lastBidder' in first.payload.auction));
    assert.ok(!('winner' in first.payload.auction));
    assert.ok(!('wallet' in first.payload.auction));
    assert.ok(!Number.isNaN(Date.parse(first.payload.serverTime)));

    const endsAt = new Date(Date.now() + 15_000);
    await Auction.updateOne({ _id: auctionId }, {
      $set: { status: 'active', startsAt: new Date(Date.now() - 1000),
        endsAt, currentPriceCents: 2, bidCount: 2, lastBidder: new mongoose.Types.ObjectId() },
    });
    const second = response();
    await getAuctionLiveState(req, second);
    assert.equal(second.statusCode, 200);
    assert.equal(second.payload.auction.status, 'active');
    assert.equal(second.payload.auction.currentPriceCents, 2);
    assert.equal(second.payload.auction.bidCount, 2);
    assert.equal(new Date(second.payload.auction.endsAt).getTime(), endsAt.getTime());
    assert.ok(!('lastBidder' in second.payload.auction));

    const invalid = response();
    await getAuctionLiveState({ params: { id: 'invalid' } }, invalid);
    assert.equal(invalid.statusCode, 400);
  } finally {
    if (auctionId) await Auction.deleteOne({ _id: auctionId });
    if (productId) await Product.deleteOne({ _id: productId, slug });
    await mongoose.disconnect();
  }
});
