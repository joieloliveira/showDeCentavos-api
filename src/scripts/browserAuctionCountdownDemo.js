// Standalone read-only browser countdown demo. NEVER connect to production MongoDB.
// Run on port 3002; the normal API on 3001 remains untouched.
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import { randomUUID } from 'node:crypto';
import Auction from '../models/Auction.js';
import Product from '../models/Product.js';
import { publishAuctionEvent, subscribeAuctionEvents } from '../services/AuctionEventsService.js';

const uri = process.env.WALLET_TEST_MONGODB_URI;
function isSafe(value) {
  if (!value) return false;
  try {
    const u = new URL(value);
    return u.protocol === 'mongodb:' && u.hostname === '127.0.0.1' &&
      u.port === '27018' && u.pathname === '/wallet_test_pix' &&
      u.searchParams.get('replicaSet') === 'walletTestRS' &&
      !u.username && !u.password;
  } catch { return false; }
}
if (!isSafe(uri)) {
  console.error('Refusing unsafe or missing WALLET_TEST_MONGODB_URI');
  process.exit(1);
}

let productId;
let auctionId;
let ticker;
let server;
let shuttingDown = false;
const slug = 'browser-countdown-demo-' + randomUUID();

async function cleanup() {
  if (shuttingDown) return;
  shuttingDown = true;
  clearInterval(ticker);
  if (server) {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
  try {
    if (auctionId) await Auction.deleteOne({ _id: auctionId });
    if (productId) await Product.deleteOne({ _id: productId, slug });
  } finally {
    await mongoose.disconnect();
  }
}
async function main() {
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
  try {
    const product = await Product.create({
      seller: new mongoose.Types.ObjectId(), slug,
      name: 'DEMONSTRAÇÃO — cronômetro de 15 segundos',
      description: 'Leilão temporário, sem pagamentos nem lances reais.',
      price: 10, stock: 1,
    });
    productId = product._id;
    const auction = await Auction.create({
      product: productId, status: 'active', bidCostCents: 50,
      currentPriceCents: 1, bidCount: 1,
      lastBidder: new mongoose.Types.ObjectId(),
      startsAt: new Date(), endsAt: null,
    });
    auctionId = auction._id;
    const app = express();
    app.use(cors({ origin: 'http://localhost:3000' }));
    app.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
    app.get('/api/auctions/:id', async (req, res) => {
      if (req.params.id !== String(auctionId)) return res.sendStatus(404);
      const current = await Auction.findById(auctionId)
        .populate('product', 'name description price images coverImage');
      return res.json({ auction: current });
    });
    // Demo-only control: reset countdown after the page is already open.
    // Loopback-only server, exact auction ID, no financial actions.
    app.post('/demo/start', async (_req, res) => {
      const deadline = new Date(Date.now() + 15_000);
      const updated = await Auction.findOneAndUpdate(
        { _id: auctionId, status: { $in: ['active', 'finished'] } },
        { $set: { status: 'active', endsAt: deadline, winner: null } },
        { returnDocument: 'after' });
      if (!updated) return res.status(409).json({ message: 'Demo unavailable' });
      publishAuctionEvent(auctionId, {
        status: updated.status, currentPriceCents: updated.currentPriceCents,
        bidCount: updated.bidCount, startsAt: updated.startsAt, endsAt: updated.endsAt,
      });
      console.log('Demo countdown restarted: 15 seconds.');
      return res.json({ endsAt: deadline.toISOString(), status: 'active' });
    });
    app.get('/api/auctions/:id/live', async (req, res) => {
      if (req.params.id !== String(auctionId)) return res.sendStatus(404);
      const current = await Auction.findById(auctionId)
        .select('status currentPriceCents bidCount startsAt endsAt bidCostCents').lean();
      return res.json({ auction: current, serverTime: new Date().toISOString() });
    });
    app.get('/api/auctions/:id/events', (req, res) => {
      if (req.params.id !== String(auctionId)) return res.sendStatus(404);
      return subscribeAuctionEvents(req, res, auctionId);
    });
    ticker = setInterval(async () => {
      try {
        const current = await Auction.findOneAndUpdate(
          { _id: auctionId, status: 'active', endsAt: { $ne: null, $lte: new Date() } },
          [{ $set: { status: 'finished', winner: '$lastBidder' } }],
          { returnDocument: 'after', updatePipeline: true });
        if (current) {
          publishAuctionEvent(auctionId, {
            status: current.status, currentPriceCents: current.currentPriceCents,
            bidCount: current.bidCount, startsAt: current.startsAt, endsAt: current.endsAt,
          });
          console.log('Demo finished; browser should show Encerrado.');
        }
      } catch (error) { console.error('Demo tick failed:', error); }
    }, 250);
    server = app.listen(3002, '127.0.0.1', () => {
      console.log('DEMO ONLY: http://localhost:3000/auctions/registered/' + auctionId);
      console.log('API demo: http://127.0.0.1:3002/api');
      console.log('Keep the browser page open, then start/restart the countdown with:');
      console.log('Invoke-RestMethod -Method Post -Uri http://127.0.0.1:3002/demo/start');
      console.log('Press Ctrl+C to delete temporary demo records.');
    });
  } catch (error) {
    await cleanup();
    throw error;
  }
}
process.on('SIGINT', () => { void cleanup().then(() => process.exit(0)).catch(() => process.exit(1)); });
process.on('SIGTERM', () => { void cleanup().then(() => process.exit(0)).catch(() => process.exit(1)); });
main().catch(error => { console.error(error); process.exitCode = 1; });
