// Orders store totals in BRL reais. Compare exact centavos, never floats.
const toCents = value => {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const text = String(value);
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(text)) return null;
  const [whole, fraction = ""] = text.split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(cents) ? cents : null;
};

export function validateApprovedOrderAmount(order, providerOrder) {
  const expected = toCents(order?.total);
  const raw = providerOrder?.raw;
  const total = toCents(raw?.total_amount);
  const payments = raw?.transactions?.payments;
  if (expected === null || total === null || !Array.isArray(payments) || payments.length !== 1) return false;
  const paymentAmount = toCents(payments[0]?.amount);
  // BRL is the only supported currency. Some Order API responses omit
  // currency_id; accept omission, reject any explicitly non-BRL currency.
  const currencies = [raw?.currency_id, payments[0]?.currency_id].filter(value => value != null);
  return paymentAmount === expected && total === expected &&
    currencies.every(value => value === "BRL");
}
