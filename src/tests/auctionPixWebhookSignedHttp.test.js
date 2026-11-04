import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import express from "express";
import MercadoPagoProvider from "../services/payments/MercadoPagoProvider.js";
import { mercadoPagoOrderWebhook } from "../controllers/webhooks/MercadoPagoWebhookController.js";

const secret = "local-webhook-hmac-test-secret";
const requestId = "local-webhook-request-123";

function signedHeaders(dataId) {
  const ts = String(Math.floor(Date.now() / 1000));
  const manifest = `id:${String(dataId).toLowerCase()};request-id:${requestId};ts:${ts};`;
  const signature = crypto.createHmac("sha256", secret).update(manifest).digest("hex");
  return {
    "content-type": "application/json",
    "x-request-id": requestId,
    "x-signature": `ts=${ts},v1=${signature}`,
  };
}

async function withServer(callback) {
  const app = express();
  app.use(express.json());
  app.post("/webhook", mercadoPagoOrderWebhook);
  const server = app.listen(0, "127.0.0.1");
  try {
    if (!server.listening) await new Promise((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
    });
    return await callback(`http://127.0.0.1:${server.address().port}/webhook`);
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

async function post(url, type = "order") {
  const dataId = "ORD-TEST-123";
  return fetch(url, {
    method: "POST",
    headers: signedHeaders(dataId),
    body: JSON.stringify({ type, data: { id: dataId } }),
  });
}

test("signed unsupported event is ignored before provider lookup", async () => {
  const previousSecret = process.env.MERCADOPAGO_WEBHOOK_SECRET;
  const originalGetOrder = MercadoPagoProvider.getOrder;
  try {
    process.env.MERCADOPAGO_WEBHOOK_SECRET = secret;
    let providerReads = 0;
    MercadoPagoProvider.getOrder = async () => { providerReads++; throw Error("Should not fetch"); };
    await withServer(async url => {
      assert.equal((await post(url, "payment")).status, 200);
    });
    assert.equal(providerReads, 0);
  } finally {
    MercadoPagoProvider.getOrder = originalGetOrder;
    if (previousSecret === undefined) delete process.env.MERCADOPAGO_WEBHOOK_SECRET;
    else process.env.MERCADOPAGO_WEBHOOK_SECRET = previousSecret;
  }
});

test("signed provider failure returns 500 for later retry", async () => {
  const previousSecret = process.env.MERCADOPAGO_WEBHOOK_SECRET;
  const originalGetOrder = MercadoPagoProvider.getOrder;
  try {
    process.env.MERCADOPAGO_WEBHOOK_SECRET = secret;
    let reads = 0;
    MercadoPagoProvider.getOrder = async () => { reads++; throw new Error("Simulated provider outage"); };
    await withServer(async url => {
      assert.equal((await post(url)).status, 500);
      assert.equal((await post(url)).status, 500);
    });
    assert.equal(reads, 2);
  } finally {
    MercadoPagoProvider.getOrder = originalGetOrder;
    if (previousSecret === undefined) delete process.env.MERCADOPAGO_WEBHOOK_SECRET;
    else process.env.MERCADOPAGO_WEBHOOK_SECRET = previousSecret;
  }
});
