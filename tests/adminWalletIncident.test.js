import assert from "node:assert/strict";
import test, { mock } from "node:test";
import isAdmin from "../src/middlewares/isAdmin.js";
import WalletPaymentIncident from "../src/models/WalletPaymentIncident.js";
import User from "../src/models/User.js";
import { listAdminWalletIncidents } from "../src/controllers/adminWalletIncidentController.js";

const res = () => ({
  code: 200, payload: null,
  status(code) { this.code = code; return this; },
  json(payload) { this.payload = payload; return this; },
});
const mockUser = (t, user) => {
  const find = mock.method(User, "findById", (id) => {
    assert.equal(id, "user-id");
    return { select(fields) {
      assert.equal(fields, "role isActive");
      return { lean: async () => user };
    } };
  });
  t.after(() => find.mock.restore());
};

test("non-admin access is denied", async (t) => {
  mockUser(t, { role: "customer", isActive: true });
  const response = res();
  let called = false;
  await isAdmin({ user: { id: "user-id", role: "admin" } }, response, () => { called = true; });
  assert.equal(response.code, 403);
  assert.equal(called, false);
});
test("missing authenticated user is denied", async () => {
  const response = res();
  await isAdmin({}, response, () => assert.fail("must not proceed"));
  assert.equal(response.code, 401);
});
test("revoked administrator role is denied despite old admin JWT", async (t) => {
  mockUser(t, { role: "customer", isActive: true });
  const response = res();
  await isAdmin({ user: { id: "user-id", role: "admin" } }, response, () => assert.fail("must not proceed"));
  assert.equal(response.code, 403);
});
test("inactive administrator is denied", async (t) => {
  mockUser(t, { role: "admin", isActive: false });
  const response = res();
  await isAdmin({ user: { id: "user-id", role: "admin" } }, response, () => assert.fail("must not proceed"));
  assert.equal(response.code, 403);
});
test("active administrator is allowed based on database role", async (t) => {
  mockUser(t, { role: "admin", isActive: true });
  const response = res();
  let called = false;
  await isAdmin({ user: { id: "user-id", role: "customer" } }, response, () => { called = true; });
  assert.equal(response.code, 200);
  assert.equal(called, true);
});
test("deleted administrator is denied", async (t) => {
  mockUser(t, null);
  const response = res();
  await isAdmin({ user: { id: "user-id", role: "admin" } }, response, () => assert.fail("must not proceed"));
  assert.equal(response.code, 403);
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
