import assert from "node:assert/strict";
import test, { mock } from "node:test";
import User from "../src/models/User.js";
import WalletTransaction from "../src/models/WalletTransaction.js";
import WalletDeposit from "../src/models/WalletDeposit.js";
import { getWalletBalance, listWalletTransactions } from "../src/controllers/walletController.js";
import { getWalletDeposit } from "../src/controllers/walletDepositController.js";

const owner = "507f1f77bcf86cd799439011";
const other = "507f1f77bcf86cd799439012";
const depositId = "507f1f77bcf86cd799439013";
function response() {
  return {
    statusCode: 200, body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}
test("wallet balance reads only the authenticated user", async (t) => {
  const select = mock.fn(async () => ({ wallet: { balanceCents: 1200 } }));
  const find = mock.method(User, "findById", (id) => {
    assert.equal(id, owner);
    return { select: () => ({ lean: select }) };
  });
  t.after(() => mock.restoreAll());
  const res = response();
  await getWalletBalance({ user: { id: owner } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.balanceCents, 1200);
  assert.equal(find.mock.callCount(), 1);
});
test("wallet history always filters by authenticated user", async (t) => {
  const find = mock.method(WalletTransaction, "find", (filter) => {
    assert.deepEqual(filter, { user: owner });
    return { sort: () => ({ skip: () => ({ limit: () => ({ lean: async () => [] }) }) }) };
  });
  const count = mock.method(WalletTransaction, "countDocuments", async (filter) => {
    assert.deepEqual(filter, { user: owner }); return 0;
  });
  t.after(() => mock.restoreAll());
  const res = response();
  await listWalletTransactions({ user: { id: owner }, query: { user: other } }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.transactions, []);
  assert.equal(find.mock.callCount(), 1);
  assert.equal(count.mock.callCount(), 1);
});
test("deposit lookup rejects a deposit belonging to another account", async (t) => {
  const find = mock.method(WalletDeposit, "findOne", async (filter) => {
    assert.deepEqual(filter, { _id: depositId, user: owner });
    return null;
  });
  t.after(() => mock.restoreAll());
  const res = response();
  await getWalletDeposit({ user: { id: owner }, params: { depositId } }, res);
  assert.equal(res.statusCode, 404);
  assert.equal(res.body.message, "Depósito não encontrado.");
  assert.equal(find.mock.callCount(), 1);
});
test("deposit lookup returns only the authenticated account's deposit", async (t) => {
  const find = mock.method(WalletDeposit, "findOne", async (filter) => {
    assert.deepEqual(filter, { _id: depositId, user: owner });
    return { _id: depositId, user: owner, amountCents: 1000, status: "pending", provider: "manual_test" };
  });
  t.after(() => mock.restoreAll());
  const res = response();
  await getWalletDeposit({ user: { id: owner }, params: { depositId } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.deposit.amountCents, 1000);
  assert.equal(find.mock.callCount(), 1);
});
