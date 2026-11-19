import assert from "node:assert/strict";
import test from "node:test";
import { mock } from "node:test";
import MercadoPagoProvider from "../src/services/payments/MercadoPagoProvider.js";
import { verifyWalletDepositPayment } from "../src/services/WalletDepositPaymentVerificationService.js";

const deposit = {
  _id: "507f1f77bcf86cd799439011",
  provider: "mercadopago",
  amountCents: 2500,
  providerOrderId: "ORD-1",
  providerPaymentId: null,
};
const approvedOrder = () => ({
  orderId: "ORD-1",
  externalReference: String(deposit._id),
  normalizedStatus: "approved",
  payment: { id: "PAY-1", method: "pix" },
  raw: { total_amount: "25.00", transactions: { payments: [{ id: "PAY-1", amount: "25.00", payment_method: { id: "pix" } }] } },
});

test("verifies approved PIX and exact amount in cents", async (t) => {
  t.after(() => mock.restoreAll());
  mock.method(MercadoPagoProvider, "getOrder", async () => approvedOrder());
  const result = await verifyWalletDepositPayment({ deposit, providerOrderId: "ORD-1" });
  assert.deepEqual(result, { approved: true, providerOrderId: "ORD-1", providerPaymentId: "PAY-1", amountCents: 2500 });
});

test("does not approve a pending payment", async (t) => {
  t.after(() => mock.restoreAll());
  mock.method(MercadoPagoProvider, "getOrder", async () => ({ ...approvedOrder(), normalizedStatus: "pending" }));
  const result = await verifyWalletDepositPayment({ deposit, providerOrderId: "ORD-1" });
  assert.equal(result.approved, false);
});

test("rejects different external reference", async (t) => {
  t.after(() => mock.restoreAll());
  mock.method(MercadoPagoProvider, "getOrder", async () => ({ ...approvedOrder(), externalReference: "another" }));
  await assert.rejects(verifyWalletDepositPayment({ deposit, providerOrderId: "ORD-1" }), /não corresponde/);
});

test("rejects a different total amount", async (t) => {
  t.after(() => mock.restoreAll());
  mock.method(MercadoPagoProvider, "getOrder", async () => ({ ...approvedOrder(), raw: { ...approvedOrder().raw, total_amount: "26.00" } }));
  await assert.rejects(verifyWalletDepositPayment({ deposit, providerOrderId: "ORD-1" }), /Valor pago diverge/);
});

test("rejects a different individual transaction amount", async (t) => {
  t.after(() => mock.restoreAll());
  const order = approvedOrder();
  order.raw.transactions.payments[0].amount = "24.00";
  mock.method(MercadoPagoProvider, "getOrder", async () => order);
  await assert.rejects(verifyWalletDepositPayment({ deposit, providerOrderId: "ORD-1" }), /transação PIX não corresponde/);
});

test("rejects multiple transactions in one order", async (t) => {
  t.after(() => mock.restoreAll());
  const order = approvedOrder();
  order.raw.transactions.payments.push({ id: "PAY-2", amount: "25.00" });
  mock.method(MercadoPagoProvider, "getOrder", async () => order);
  await assert.rejects(verifyWalletDepositPayment({ deposit, providerOrderId: "ORD-1" }), /exatamente uma transação/);
});

test("rejects a non-PIX payment", async (t) => {
  t.after(() => mock.restoreAll());
  mock.method(MercadoPagoProvider, "getOrder", async () => ({ ...approvedOrder(), payment: { id: "PAY-1", method: "credit_card" } }));
  await assert.rejects(verifyWalletDepositPayment({ deposit, providerOrderId: "ORD-1" }), /incompatível/);
});

test("rejects a different previously stored payment ID", async (t) => {
  t.after(() => mock.restoreAll());
  mock.method(MercadoPagoProvider, "getOrder", async () => approvedOrder());
  await assert.rejects(verifyWalletDepositPayment({ deposit: { ...deposit, providerPaymentId: "PAY-OTHER" }, providerOrderId: "ORD-1" }), /Pagamento diverge/);
});
