import assert from "node:assert/strict";
import test, { mock } from "node:test";
import WalletPaymentIncident from "../src/models/WalletPaymentIncident.js";
import WalletDeposit from "../src/models/WalletDeposit.js";
import User from "../src/models/User.js";
import { getAdminWalletIncident } from "../src/controllers/adminWalletIncidentController.js";

const id = "507f1f77bcf86cd799439011";
const userId = "507f1f77bcf86cd799439012";
const depositId = "507f1f77bcf86cd799439013";
const res = () => ({
  code: 200, payload: null,
  status(code) { this.code = code; return this; },
  json(payload) { this.payload = payload; return this; },
});
const query = (value) => ({ select() { return this; }, async lean() { return value; } });

test("incident detail rejects invalid identifiers", async () => {
  const response = res();
  await getAdminWalletIncident({ params: { incidentId: "invalid" } }, response);
  assert.equal(response.code, 400);
});
test("incident detail returns 404 when incident does not exist", async (t) => {
  mock.method(WalletPaymentIncident, "findById", () => query(null));
  t.after(() => mock.restoreAll());
  const response = res();
  await getAdminWalletIncident({ params: { incidentId: id } }, response);
  assert.equal(response.code, 404);
});
test("incident detail returns linked deposit and limited user data", async (t) => {
  mock.method(WalletPaymentIncident, "findById", () => query({
    _id: id, user: userId, deposit: depositId, provider: "mercadopago",
    providerOrderId: "ORD-1", providerStatus: "refunded",
  }));
  mock.method(WalletDeposit, "findById", () => query({
    _id: depositId, user: userId, provider: "mercadopago",
    providerOrderId: "ORD-1", amountCents: 1000, status: "approved",
  }));
  mock.method(User, "findById", () => query({
    _id: userId, name: "Test", email: "test@example.invalid", isActive: true,
    password: "must-not-leak",
  }));
  t.after(() => mock.restoreAll());
  const response = res();
  await getAdminWalletIncident({ params: { incidentId: id } }, response);
  assert.equal(response.code, 200);
  assert.equal(response.payload.deposit.amountCents, 1000);
  assert.equal(response.payload.user.name, "Test");
  assert.equal(response.payload.user.password, undefined);
});
test("incident detail hides a deposit with mismatched ownership", async (t) => {
  mock.method(WalletPaymentIncident, "findById", () => query({
    _id: id, user: userId, deposit: depositId, provider: "mercadopago", providerOrderId: "ORD-1",
  }));
  mock.method(WalletDeposit, "findById", () => query({
    _id: depositId, user: id, provider: "mercadopago", providerOrderId: "ORD-1", amountCents: 1000,
  }));
  mock.method(User, "findById", () => query(null));
  t.after(() => mock.restoreAll());
  const response = res();
  await getAdminWalletIncident({ params: { incidentId: id } }, response);
  assert.equal(response.code, 200);
  assert.equal(response.payload.deposit, null);
});
