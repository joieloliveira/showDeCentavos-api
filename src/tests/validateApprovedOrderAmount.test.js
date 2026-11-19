import test from "node:test";
import assert from "node:assert/strict";
import { validateApprovedOrderAmount } from "../services/payments/validateApprovedOrderAmount.js";

const provider = (total = "100.00", amount = "100.00", currency = "BRL") => ({
  raw: { total_amount: total, currency_id: currency, transactions: { payments: [{ amount }] } }
});

test("approved amount validator accepts matching BRL order and payment", () => {
  assert.equal(validateApprovedOrderAmount({ total: 100 }, provider()), true);
  assert.equal(validateApprovedOrderAmount({ total: 0.01 }, provider("0.01", "0.01")), true);
});
test("approved amount validator rejects underpayment, overpayment and inconsistent totals", () => {
  for (const result of [provider("99.99", "99.99"), provider("100.01", "100.01"), provider("100.00", "99.99")]) {
    assert.equal(validateApprovedOrderAmount({ total: 100 }, result), false);
  }
});
test("approved amount validator rejects missing or invalid amount and non-BRL currency", () => {
  assert.equal(validateApprovedOrderAmount({ total: 100 }, { raw: {} }), false);
  assert.equal(validateApprovedOrderAmount({ total: 100 }, provider("100.00", "100.00", "USD")), false);
  assert.equal(validateApprovedOrderAmount({ total: 100 }, provider("100.001", "100.00")), false);
  assert.equal(validateApprovedOrderAmount({ total: 100 }, { raw: { total_amount: "100.00", transactions: { payments: [] } } }), false);
});
