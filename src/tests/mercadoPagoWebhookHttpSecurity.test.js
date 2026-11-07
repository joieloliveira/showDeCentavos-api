import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createHmac } from "node:crypto";
import MercadoPagoProvider from "../services/payments/MercadoPagoProvider.js";
import { mercadoPagoOrderWebhook } from "../controllers/webhooks/MercadoPagoWebhookController.js";

const secret = "webhook-http-isolated-test-secret";
const orderId = "ORDTST-WEBHOOK-123";
async function withWebhook(providerResult, run) {
  const oldSecret = process.env.MERCADOPAGO_WEBHOOK_SECRET;
  const oldGetOrder = MercadoPagoProvider.getOrder;
  let calls = 0;
  let server;
  try {
    process.env.MERCADOPAGO_WEBHOOK_SECRET = secret;
    MercadoPagoProvider.getOrder = async () => { calls++; return providerResult; };
    const app = express();
    app.use(express.json());
    app.post("/api/payments/webhook", mercadoPagoOrderWebhook);
    server = app.listen(0, "127.0.0.1");
    await new Promise(resolve => server.once("listening", resolve));
    const url = `http://127.0.0.1:${server.address().port}/api/payments/webhook?data.id=${orderId}&type=order`;
    const send = async (signed = true) => {
      const requestId = "request-test-123";
      const ts = String(Math.floor(Date.now() / 1000));
      const manifest = `id:${orderId};request-id:${requestId};ts:${ts};`;
      const hash = createHmac("sha256", secret).update(manifest).digest("hex");
      const headers = { "content-type": "application/json" };
      if (signed) {
        headers["x-request-id"] = requestId;
        headers["x-signature"] = `ts=${ts},v1=${hash}`;
      }
      return fetch(url, { method: "POST", headers, body: JSON.stringify({ type: "order", data: { id: orderId } }) });
    };
    await run(send, () => calls);
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    MercadoPagoProvider.getOrder = oldGetOrder;
    if (oldSecret === undefined) delete process.env.MERCADOPAGO_WEBHOOK_SECRET;
    else process.env.MERCADOPAGO_WEBHOOK_SECRET = oldSecret;
  }
}

test("unsigned HTTP webhook is rejected before provider lookup", async () => {
  await withWebhook(null, async (send, calls) => {
    assert.equal((await send(false)).status, 401);
    assert.equal(calls(), 0);
  });
});
test("signed webhook retries when provider lookup is unavailable", async () => {
  await withWebhook(null, async (send, calls) => {
    assert.equal((await send()).status, 500);
    assert.equal(calls(), 1);
  });
});
test("signed webhook rejects provider order ID mismatch before database writes", async () => {
  await withWebhook({ orderId: "ORDTST-OTHER", externalReference: "not-an-order" }, async (send, calls) => {
    assert.equal((await send()).status, 500);
    assert.equal(calls(), 1);
  });
});
