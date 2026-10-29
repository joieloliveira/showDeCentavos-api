import assert from "node:assert/strict";
import test, { mock } from "node:test";
import isAdmin from "../src/middlewares/isAdmin.js";
import WalletPaymentIncident from "../src/models/WalletPaymentIncident.js";
import { listAdminWalletIncidents } from "../src/controllers/adminWalletIncidentController.js";

const res = () => ({
  code: 200, payload: null,
  status(code) { this.code = code; return this; },
  json(payload) { this.payload = payload; return this; },
});
test("non-admin access is denied", () => {
  const response = res();
  let called = false;
  isAdmin({ user: { role: "customer" } }, response, () => { called = true; });
  assert.equal(response.code, 403);
  assert.equal(called, false);
});
test("missing authenticated user is denied", () => {
  const response = res();
  isAdmin({}, response, () => assert.fail("must not proceed"));
  assert.equal(response.code, 401);
});
test("invalid filters are rejected before querying database", async () => {
  const response = res();
  await listAdminWalletIncidents({ query: { providerStatus: "unknown" } }, response);
  assert.equal(response.code, 400);
});
test("invalid pagination is rejected", async () => {
  const response = res();
  await listAdminWalletIncidents({ query: { page: "0" } }, response);
  assert.equal(response.code, 400);
});
test("admin incident listing filters and paginates read-only", async (t) => {
  const count = mock.method(WalletPaymentIncident, "countDocuments", async (filter) => {
    assert.deepEqual(filter, { resolution: "review_required", providerStatus: "refunded" });
    return 1;
  });
  const chain = {
    select() { return this; },
    sort() { return this; },
    skip(n) { assert.equal(n, 0); return this; },
    limit(n) { assert.equal(n, 10); return this; },
    lean: async () => [{ providerStatus: "refunded" }],
  };
  const find = mock.method(WalletPaymentIncident, "find", (filter) => {
    assert.deepEqual(filter, { resolution: "review_required", providerStatus: "refunded" });
    return chain;
  });
  t.after(() => mock.restoreAll());
  const response = res();
  await listAdminWalletIncidents({
    query: { resolution: "review_required", providerStatus: "refunded", page: "1", limit: "10" },
  }, response);
  assert.equal(response.code, 200);
  assert.equal(response.payload.incidents.length, 1);
  assert.equal(response.payload.pagination.totalPages, 1);
  assert.equal(count.mock.callCount(), 1);
  assert.equal(find.mock.callCount(), 1);
});
