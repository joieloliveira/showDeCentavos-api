import test from "node:test";
import assert from "node:assert/strict";
import { addressWriteDecision } from "../services/auctionAddressPolicy.js";

const winner = "winner-1";
const auction = { status: "finished", winner };
const allowed = { featureEnabled: true, authenticatedUserId: winner, auction, fulfillment: null };
const check = overrides => addressWriteDecision({ ...allowed, ...overrides }).status;

test("feature flag prevents writes", () => assert.equal(check({ featureEnabled: false }), 503));
test("missing authentication is rejected", () => assert.equal(check({ authenticatedUserId: null }), 401));
test("different winner cannot write", () => assert.equal(check({ authenticatedUserId: "attacker" }), 404));
test("missing auction cannot be used", () => assert.equal(check({ auction: null }), 404));
test("active auction cannot accept delivery address", () => assert.equal(check({ auction: { ...auction, status: "active" } }), 404));
test("winner may write before delivery starts", () => assert.equal(check({}), 200));
test("fulfillment owner mismatch is rejected", () => assert.equal(check({ fulfillment: { winner: "other", deliveryStatus: "not_started" } }), 403));
test("delivery preparation locks address changes", () => assert.equal(check({ fulfillment: { winner, deliveryStatus: "preparing" } }), 409));
test("shipped delivery locks address changes", () => assert.equal(check({ fulfillment: { winner, deliveryStatus: "shipped" } }), 409));
test("not started delivery allows address update", () => assert.equal(check({ fulfillment: { winner, deliveryStatus: "not_started" } }), 200));
