import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { mercadoPagoOrderWebhook } from "../controllers/webhooks/MercadoPagoWebhookController.js";

async function withServer(callback) {
  const app = express();
  app.use(express.json());
  app.post("/webhook", mercadoPagoOrderWebhook);
  const server = app.listen(0, "127.0.0.1");
  try {
    await new Promise((resolve, reject) => {
      if (server.listening) resolve();
      else {
        server.once("listening", resolve);
        server.once("error", reject);
      }
    });
    return await callback(`http://127.0.0.1:${server.address().port}/webhook`);
  } finally {
    await new Promise((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
  }
}

test("HTTP webhook ignores notifications without order id", async () => {
  await withServer(async url => {
    const response = await fetch(url, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "order" }),
    });
    assert.equal(response.status, 200);
  });
});

test("HTTP webhook rejects missing signature and request id", async () => {
  await withServer(async url => {
    const response = await fetch(url, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "order", data: { id: "ORD123" } }),
    });
    assert.equal(response.status, 401);
  });
});

test("HTTP webhook rejects invalid signature before provider lookup", async () => {
  const previous = process.env.MERCADOPAGO_WEBHOOK_SECRET;
  process.env.MERCADOPAGO_WEBHOOK_SECRET = "test-only-secret";
  try {
    await withServer(async url => {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-signature": "ts=1700000000,v1=invalid-signature",
          "x-request-id": "test-request-id",
        },
        body: JSON.stringify({ type: "order", data: { id: "ORD123" } }),
      });
      assert.equal(response.status, 401);
    });
  } finally {
    if (previous === undefined) delete process.env.MERCADOPAGO_WEBHOOK_SECRET;
    else process.env.MERCADOPAGO_WEBHOOK_SECRET = previous;
  }
});

test("HTTP webhook ignores unsupported event type after valid signature", { skip: "Requires correctly signed Mercado Pago fixture; not covered by invalid-signature tests" }, () => {});
