// Standalone read-only browser countdown demo. NEVER connect to production MongoDB.
// Run on port 3002; the normal API on 3001 remains untouched.
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import { randomUUID } from 'node:crypto';
import Auction from '../models/Auction.js';
import Product from '../models/Product.js';
import User from '../models/User.js';
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

let demoUserId;
let productId;
let auctionId;
let ticker;
let server;
let shuttingDown = false;
const slug = 'browser-countdown-demo-' + randomUUID();
const demoEmail = 'demo-winner-' + randomUUID() + '@example.invalid';

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
    if (demoUserId) await User.deleteOne({ _id: demoUserId, email: demoEmail });
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
    const demoUser = await User.create({ name: 'Demo Winner', email: demoEmail, publicNickname: 'VencedorDemo' });
    demoUserId = demoUser._id;
    const auction = await Auction.create({
      product: productId, status: 'scheduled', bidCostCents: 50,
      currentPriceCents: 1, bidCount: 1,
      lastBidder: demoUserId,
      startsAt: null, waitingStartedAt: null, endsAt: null,
    });
    auctionId = auction._id;
    const app = express();
    app.use(cors({ origin: 'http://localhost:3000' }));
    app.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
    // Catalog demo exposes only its own temporary auction, never test database records.
    app.get('/api/auctions', async (_req, res) => {
      const current = await Auction.findById(auctionId)
        .populate('product', 'name price images coverImage').lean();
      if (!current) return res.json({ auctions: [] });
      const { winner, lastBidder, ...publicAuction } = current;
      return res.json({ auctions: [{
        ...publicAuction,
        winnerNickname: current.status === 'finished' && winner ? demoUser.publicNickname : null,
      }] });
    });
    app.get('/api/auctions/:id', async (req, res) => {
      if (req.params.id !== String(auctionId)) return res.sendStatus(404);
      const current = await Auction.findById(auctionId)
        .populate('product', 'name description price images coverImage');
      const safe = current.toObject();
      delete safe.winner;
      delete safe.lastBidder;
      safe.winnerNickname = current.status === 'finished' && current.winner ? demoUser.publicNickname : null;
      return res.json({ auction: safe });
    });
    // Demo-only control: reset countdown after the page is already open.
    // Loopback-only server, exact auction ID, no financial actions.
    app.post('/demo/schedule', async (_req, res) => {
      const now = new Date();
      const startsAt = new Date(now.getTime() + 10_000);
      const updated = await Auction.findOneAndUpdate(
        { _id: auctionId, status: { $in: ['scheduled', 'active', 'finished'] } },
        { $set: { status: 'scheduled', waitingStartedAt: now, startsAt, endsAt: null, winner: null } },
        { returnDocument: 'after' });
      if (!updated) return res.status(409).json({ message: 'Demo unavailable' });
      publishAuctionEvent(auctionId, { status: 'scheduled', startsAt, endsAt: null,
        currentPriceCents: updated.currentPriceCents, bidCount: updated.bidCount });
      return res.json({ status: 'scheduled', startsAt: startsAt.toISOString() });
    });
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
        .select('status currentPriceCents bidCount startsAt endsAt bidCostCents winner').lean();
      const { winner, ...publicAuction } = current;
      return res.json({ auction: { ...publicAuction, winnerNickname: current.status === 'finished' && winner ? demoUser.publicNickname : null }, serverTime: new Date().toISOString() });
    });
    app.get('/api/auctions/:id/events', (req, res) => {
      if (req.params.id !== String(auctionId)) return res.sendStatus(404);
      return subscribeAuctionEvents(req, res, auctionId);
    });
    ticker = setInterval(async () => {
      try {
        const started = await Auction.findOneAndUpdate(
          { _id: auctionId, status: 'scheduled', waitingStartedAt: { $ne: null }, startsAt: { $lte: new Date() } },
          { $set: { status: 'active', endsAt: new Date(Date.now() + 15_000) } },
          { returnDocument: 'after' });
        if (started) {
          publishAuctionEvent(auctionId, { status: started.status, startsAt: started.startsAt,
            endsAt: started.endsAt, currentPriceCents: started.currentPriceCents, bidCount: started.bidCount });
          console.log('Demo scheduled auction activated; 15-second countdown started.');
        }
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
      console.log('CATALOG DEMO: http://localhost:3000/auctions');
      console.log('To test scheduled -> active -> finished, run:');
      console.log('Invoke-RestMethod -Method Post -Uri http://127.0.0.1:3002/demo/schedule');
      console.log('Or start/restart the active countdown directly:');
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
