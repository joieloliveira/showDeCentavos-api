import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { configureTrustedProxy, trustedProxyAddress } from "../config/trustedProxy.js";
import { createAuthRateLimiter } from "../middlewares/authRateLimiter.js";

async function withServer(env, run) {
  const app = express();
  configureTrustedProxy(app, env);
  app.post("/login", createAuthRateLimiter({ maxAttempts: 1, windowMs: 60_000 }),
    (req, res) => res.json({ ip: req.ip }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const url = "http://127.0.0.1:" + server.address().port + "/login";
  const send = async forwarded => fetch(url, { method: "POST",
    headers: forwarded ? { "x-forwarded-for": forwarded } : {} });
  try { await run(send); }
  finally { await new Promise(resolve => server.close(resolve)); }
}

test("untrusted X-Forwarded-For cannot bypass IP limiter", async () => {
  await withServer({}, async send => {
    assert.equal((await send("198.51.100.1")).status, 200);
    assert.equal((await send("198.51.100.2")).status, 429);
  });
});
test("trusted reverse proxy separates clients using forwarded IP", async () => {
  await withServer({ TRUSTED_PROXY_IP: "127.0.0.1" }, async send => {
    assert.equal((await send("198.51.100.1")).status, 200);
    assert.equal((await send("198.51.100.2")).status, 200);
    assert.equal((await send("198.51.100.1")).status, 429);
  });
});
test("reject invalid trusted proxy configuration", () => {
  assert.throws(() => trustedProxyAddress({ TRUSTED_PROXY_IP: "0.0.0.0/0" }), /TRUSTED_PROXY_IP/);
  assert.equal(trustedProxyAddress({}), null);
});
