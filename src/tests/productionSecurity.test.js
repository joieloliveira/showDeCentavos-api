import test from "node:test";
import assert from "node:assert/strict";
import { allowedCorsOrigins, validateProductionSecrets } from "../config/productionSecurity.js";

const strong = "xJ8%q2L#p9R@w4Y!m6D&v3N^s7K*e5Z?";
test("production requires strong JWT secret", () => {
  assert.throws(() => validateProductionSecrets({
    NODE_ENV: "production", JWT_SECRET: "changeme",
    CORS_ALLOWED_ORIGINS: "https://showdecentavos.example"
  }), /JWT_SECRET/);
  assert.doesNotThrow(() => validateProductionSecrets({
    NODE_ENV: "production", JWT_SECRET: strong,
    CORS_ALLOWED_ORIGINS: "https://showdecentavos.example"
  }));
});
test("production requires explicitly configured HTTPS CORS origins", () => {
  assert.throws(() => allowedCorsOrigins({ NODE_ENV: "production" }), /CORS_ALLOWED_ORIGINS/);
  assert.throws(() => allowedCorsOrigins({
    NODE_ENV: "production", CORS_ALLOWED_ORIGINS: "http://example.com"
  }), /HTTPS/);
  assert.deepEqual(allowedCorsOrigins({
    NODE_ENV: "production",
    CORS_ALLOWED_ORIGINS: "https://example.com,https://admin.example.com"
  }), ["https://example.com", "https://admin.example.com"]);
});
test("development keeps local frontend origins", () => {
  const origins = allowedCorsOrigins({ NODE_ENV: "development" });
  assert.ok(origins.includes("http://localhost:3000"));
  assert.ok(origins.includes("http://127.0.0.1:3000"));
  assert.doesNotThrow(() => validateProductionSecrets({ NODE_ENV: "development" }));
});
