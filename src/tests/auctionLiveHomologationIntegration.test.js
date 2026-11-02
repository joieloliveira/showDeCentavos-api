import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import mongoose from "mongoose";
import auctionRoutes from "../routes/auctionRoutes.js";
import Auction from "../models/Auction.js";
import User from "../models/User.js";
import Bid from "../models/Bid.js";
import WalletTransaction from "../models/WalletTransaction.js";
import { processAuctionSchedules } from "../services/AuctionSchedulerService.js";

const uri = process.env.WALLET_TEST_MONGODB_URI || "";
const safe = /^mongodb:\/\/127\.0\.0\.1:27018\/wallet_test_pix\?/.test(uri) &&
  /(?:\?|&)replicaSet=walletTestRS(?:&|$)/.test(uri);
const integration = safe ? test : test.skip;
let server, base, auctionId, userId;
if (safe) {
  before(async () => {
    await mongoose.connect(uri, { dbName: `auction_live_test_${process.pid}_${Date.now()}`, serverSelectionTimeoutMS: 5000 });
    const user = await User.create({ name: "Live Test", email: `live-${Date.now()}@example.test`, wallet: { balanceCents: 100 } });
    userId = user._id;
    const auction = await Auction.create({
      product: new mongoose.Types.ObjectId(), status: "scheduled", bidCostCents: 50,
      waitingStartedAt: new Date(Date.now() - 90000), startsAt: new Date(Date.now() - 30000)
    });
    auctionId = auction._id;
    const app = express();
    app.use(express.json());
    app.use("/api/auctions", auctionRoutes);
    server = app.listen(0, "127.0.0.1");
    await new Promise(resolve => server.once("listening", resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
    if (mongoose.connection.readyState === 1) await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });
}
integration("scheduler activates scheduled auction and live endpoint returns server clock", async () => {
  await processAuctionSchedules();
  const response = await fetch(`${base}/api/auctions/${auctionId}/live`);
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.auction.status, "active");
  assert.equal(data.auction.bidCount, 0);
  assert.ok(Math.abs(Date.parse(data.serverTime) - Date.now()) < 5000);
  assert.equal(data.auction.winner, undefined);
  assert.equal(data.auction.lastBidder, undefined);
});
integration("synthetic timed auction finishes and live endpoint shows final result", async () => {
  await Auction.updateOne({ _id: auctionId }, {
    $set: { bidCount: 1, currentPriceCents: 1, lastBidder: userId, endsAt: new Date(Date.now() - 1000) }
  });
  await processAuctionSchedules();
  const response = await fetch(`${base}/api/auctions/${auctionId}/live`);
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.auction.status, "finished");
  assert.equal(data.auction.currentPriceCents, 1);
  assert.equal(data.auction.bidCount, 1);
  assert.equal(data.auction.winner, undefined);
  assert.equal(String((await Auction.findById(auctionId)).winner), String(userId));
  assert.equal((await User.findById(userId)).wallet.balanceCents, 100);
  assert.equal(await Bid.countDocuments(), 0);
  assert.equal(await WalletTransaction.countDocuments({ type: "bid" }), 0);
});

integration("SSE broadcasts scheduler activation to a connected browser client", async () => {
  const auction = await Auction.create({
    product: new mongoose.Types.ObjectId(),
    status: "scheduled",
    bidCostCents: 50,
    waitingStartedAt: new Date(Date.now() - 90000),
    startsAt: new Date(Date.now() - 30000)
  });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  let reader;
  try {
    const response = await fetch(`${base}/api/auctions/${auction._id}/events`, {
      signal: controller.signal,
      headers: { Accept: "text/event-stream" }
    });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") || "", /text\/event-stream/);
    reader = response.body.getReader();
    const initial = new TextDecoder().decode((await reader.read()).value);
    assert.match(initial, /: connected/);
    await processAuctionSchedules();
    let received = "";
    while (!received.includes("\\n\\n") && !received.includes("auction-update")) {
      const chunk = await reader.read();
      if (chunk.done) break;
      received += new TextDecoder().decode(chunk.value);
    }
    assert.match(received, /event: auction-update/);
    assert.match(received, /"status":"active"/);
    assert.equal((await Auction.findById(auction._id)).status, "active");
  } finally {
    controller.abort();
    clearTimeout(timeout);
    if (reader) await reader.cancel().catch(() => {});
  }
});
