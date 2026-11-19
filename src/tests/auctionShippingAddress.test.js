import test from "node:test";
import assert from "node:assert/strict";
import { validateAuctionShippingAddress } from "../services/auctionShippingAddress.js";

const valid = {
  recipientName: "Pessoa Teste", phone: "(91) 99999-9999", zipCode: "66000-000",
  street: "Rua Exemplo", number: "123", complement: "Apto 1",
  neighborhood: "Centro", city: "Belém", state: "pa"
};

test("normalizes a Brazilian shipping address", () => {
  const result = validateAuctionShippingAddress(valid);
  assert.equal(result.zipCode, "66000000");
  assert.equal(result.phone, "91999999999");
  assert.equal(result.state, "PA");
  assert.equal(result.country, "BR");
});

test("requires all mandatory fields", () => {
  for (const key of ["recipientName", "phone", "zipCode", "street", "number", "neighborhood", "city", "state"]) {
    const missing = { ...valid };
    delete missing[key];
    assert.throws(() => validateAuctionShippingAddress(missing), key);
  }
});

test("rejects invalid CEP, phone and state", () => {
  assert.throws(() => validateAuctionShippingAddress({ ...valid, zipCode: "123" }));
  assert.throws(() => validateAuctionShippingAddress({ ...valid, phone: "123" }));
  assert.throws(() => validateAuctionShippingAddress({ ...valid, state: "Para" }));
});

test("rejects invalid payloads and oversized complement", () => {
  assert.throws(() => validateAuctionShippingAddress(null));
  assert.throws(() => validateAuctionShippingAddress([]));
  assert.throws(() => validateAuctionShippingAddress({ ...valid, complement: "x".repeat(121) }));
});
