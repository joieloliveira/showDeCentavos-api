import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import AuctionAuditEvent from "../models/AuctionAuditEvent.js";
import { recordAuctionAuditEvent } from "../services/AuctionAuditService.js";

const uri = process.env.WALLET_TEST_MONGODB_URI;
const safe = (() => {
  if (!uri) return false;
  try {
    const parsed = new URL(uri);
    return ["127.0.0.1", "localhost"].includes(parsed.hostname)
      && parsed.port === "27018"
      && parsed.pathname === "/wallet_test_pix"
      && parsed.searchParams.get("replicaSet") === "walletTestRS";
  } catch { return false; }
})();

test("auction audit persists distinct events exactly once on isolated MongoDB", { skip: !safe && "Requires local isolated WALLET_TEST_MONGODB_URI on port 27018" }, async () => {
  const auction = new mongoose.Types.ObjectId();
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
  try {
    const at = new Date("2026-11-02T12:00:00.000Z");
    const types = ["created", "waiting_started", "activated", "finished"];
    const sources = ["admin", "admin", "scheduler", "scheduler"];
    for (let i = 0; i < types.length; i++) {
      await recordAuctionAuditEvent(auction, types[i], new Date(at.getTime() + i * 60000), sources[i]);
    }
    await Promise.all(Array.from({ length: 8 }, () =>
      recordAuctionAuditEvent(auction, "activated", new Date(at.getTime() + 120000), "scheduler")
    ));
    const events = await AuctionAuditEvent.find({ auction }).sort({ occurredAt: 1 }).lean();
    assert.deepEqual(events.map(e => e.eventType), types);
    assert.deepEqual(events.map(e => e.source), sources);
    assert.equal(events.length, 4);
    assert.ok(events.every(e => e.auction.equals(auction)));
  } finally {
    await AuctionAuditEvent.deleteMany({ auction });
    await mongoose.disconnect();
  }
});
