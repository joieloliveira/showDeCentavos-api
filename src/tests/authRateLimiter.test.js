import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createAuthRateLimiter } from "../middlewares/authRateLimiter.js";

test("authentication limiter rejects excess requests with Retry-After and no handler execution", async () => {
  const app = express();
  let handled = 0;
  const limiter = createAuthRateLimiter({ maxAttempts: 2, windowMs: 60_000 });
  app.post("/login", limiter, (req, res) => { handled++; res.json({ ok: true }); });
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  try {
    const url = "http://127.0.0.1:" + server.address().port + "/login";
    const a = await fetch(url, { method: "POST" });
    const b = await fetch(url, { method: "POST" });
    const c = await fetch(url, { method: "POST" });
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    assert.equal(c.status, 429);
    assert.ok(Number(c.headers.get("retry-after")) > 0);
    assert.equal(handled, 2);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test("authentication limiter expires its window", async () => {
  const app = express();
  app.post("/login", createAuthRateLimiter({ maxAttempts: 1, windowMs: 20 }),
    (req, res) => res.json({ ok: true }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  try {
    const url = "http://127.0.0.1:" + server.address().port + "/login";
    assert.equal((await fetch(url, { method: "POST" })).status, 200);
    assert.equal((await fetch(url, { method: "POST" })).status, 429);
    await new Promise(resolve => setTimeout(resolve, 40));
    assert.equal((await fetch(url, { method: "POST" })).status, 200);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
