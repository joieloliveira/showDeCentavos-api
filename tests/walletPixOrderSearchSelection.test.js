import assert from "node:assert/strict";
import test from "node:test";
import { selectWalletPixOrderCandidate } from "../src/services/WalletPixOrderSearchSelection.js";

const ref = "507f1f77bcf86cd799439011";
const order = { id: "ORD-1", external_reference: ref };

test("selects one exact matching order", () => {
  assert.deepEqual(selectWalletPixOrderCandidate({ results: [order], paging: { total: 1 } }, ref), {
    recovered: true, providerOrderId: "ORD-1",
  });
});

test("does not accept multiple matching orders", () => {
  assert.equal(selectWalletPixOrderCandidate([order, { ...order, id: "ORD-2" }], ref).reason, "AMBIGUOUS_ORDERS");
});

test("does not accept incomplete search results", () => {
  assert.equal(selectWalletPixOrderCandidate({ results: [order], paging: { total: 2 } }, ref).reason, "INCOMPLETE_SEARCH_RESULTS");
});

test("does not trust unknown response shape", () => {
  assert.equal(selectWalletPixOrderCandidate({ data: [order] }, ref).reason, "UNRECOGNIZED_SEARCH_RESPONSE");
});

test("ignores orders belonging to other deposits", () => {
  assert.equal(selectWalletPixOrderCandidate([{ ...order, external_reference: "other" }], ref).reason, "ORDER_NOT_FOUND");
});

test("rejects missing order IDs", () => {
  assert.equal(selectWalletPixOrderCandidate([{ external_reference: ref }], ref).reason, "INVALID_ORDER_ID");
});

test("rejects invalid pagination totals", () => {
  assert.equal(selectWalletPixOrderCandidate({ results: [order], paging: { total: "not-a-number" } }, ref).reason, "INCOMPLETE_SEARCH_RESULTS");
});
