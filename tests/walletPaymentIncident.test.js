import assert from "node:assert/strict";
import test, { mock } from "node:test";
import WalletPaymentIncident from "../src/models/WalletPaymentIncident.js";
import { recordWalletPaymentIncident } from "../src/services/WalletPaymentIncidentService.js";

const deposit = { _id: "507f1f77bcf86cd799439011", user: "507f1f77bcf86cd799439012", provider: "mercadopago", providerOrderId: "ORD-1" };
const order = { orderId: "ORD-1", externalReference: String(deposit._id), normalizedStatus: "refunded" };

test("refunded order records review incident without changing wallet", async (t) => {
  const update = mock.method(WalletPaymentIncident, "findOneAndUpdate", async (filter, changes, options) => {
    assert.deepEqual(filter, { deposit: deposit._id, providerStatus: "refunded" });
    assert.equal(changes.$setOnInsert.resolution, "review_required");
    assert.equal(options.upsert, true);
    return { ...filter };
  });
  t.after(() => mock.restoreAll());
  await recordWalletPaymentIncident({ deposit, providerOrder: order });
  assert.equal(update.mock.callCount(), 1);
});

test("rejects mismatched external reference", async () => {
  await assert.rejects(recordWalletPaymentIncident({ deposit, providerOrder: { ...order, externalReference: "other" } }), /não corresponde/);
});

test("rejects pending orders", async () => {
  await assert.rejects(recordWalletPaymentIncident({ deposit, providerOrder: { ...order, normalizedStatus: "pending" } }), /não corresponde/);
});
