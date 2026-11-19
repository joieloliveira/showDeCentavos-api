import assert from "node:assert/strict";
import test, { mock } from "node:test";
import User from "../src/models/User.js";
import WalletDeposit from "../src/models/WalletDeposit.js";
import { createWalletPixDeposit } from "../src/controllers/walletDepositController.js";

const response = () => ({
  code: 200, payload: null,
  status(code) { this.code = code; return this; },
  json(payload) { this.payload = payload; return this; },
});

test("PIX charge creation is disabled by default, before any database or provider work", async (t) => {
  const previous = process.env.WALLET_PIX_CHARGES_ENABLED;
  delete process.env.WALLET_PIX_CHARGES_ENABLED;
  const userQuery = mock.method(User, "findOne", () => { throw new Error("database must not be queried"); });
  const depositCreate = mock.method(WalletDeposit, "create", () => { throw new Error("deposit must not be created"); });
  t.after(() => {
    mock.restoreAll();
    if (previous === undefined) delete process.env.WALLET_PIX_CHARGES_ENABLED;
    else process.env.WALLET_PIX_CHARGES_ENABLED = previous;
  });
  const res = response();
  await createWalletPixDeposit({ body: { amountCents: 1000 }, user: { id: "507f1f77bcf86cd799439011" } }, res);
  assert.equal(res.code, 503);
  assert.match(res.payload.message, /não estão habilitadas/);
  assert.equal(userQuery.mock.callCount(), 0);
  assert.equal(depositCreate.mock.callCount(), 0);
});

test("PIX charge creation rejects non-explicit enable values", async (t) => {
  const previous = process.env.WALLET_PIX_CHARGES_ENABLED;
  process.env.WALLET_PIX_CHARGES_ENABLED = "1";
  t.after(() => {
    if (previous === undefined) delete process.env.WALLET_PIX_CHARGES_ENABLED;
    else process.env.WALLET_PIX_CHARGES_ENABLED = previous;
  });
  const res = response();
  await createWalletPixDeposit({ body: { amountCents: 1000 } }, res);
  assert.equal(res.code, 503);
});

test("explicitly enabled PIX still validates amount before creating a charge", async (t) => {
  const previous = process.env.WALLET_PIX_CHARGES_ENABLED;
  process.env.WALLET_PIX_CHARGES_ENABLED = "true";
  t.after(() => {
    if (previous === undefined) delete process.env.WALLET_PIX_CHARGES_ENABLED;
    else process.env.WALLET_PIX_CHARGES_ENABLED = previous;
  });
  const res = response();
  await createWalletPixDeposit({ body: { amountCents: 50 } }, res);
  assert.equal(res.code, 400);
});
