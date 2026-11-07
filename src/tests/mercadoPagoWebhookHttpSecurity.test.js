import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import mongoose from "mongoose";
import Order from "../models/Order.js";
import FinancialReconciliationIncident from "../models/FinancialReconciliationIncident.js";
import Product from "../models/Product.js";
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
    MercadoPagoProvider.getOrder = async () => { calls++; return typeof providerResult === "function" ? providerResult(calls) : providerResult; };
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

const mongoUri = process.env.WALLET_TEST_MONGODB_URI || "";
const safeMongo = /^mongodb:\/\/127\.0\.0\.1:27018\/wallet_test_pix\?/.test(mongoUri) &&
  /(?:\?|&)replicaSet=walletTestRS(?:&|$)/.test(mongoUri) &&
  !/@|authSource=|directConnection=/.test(mongoUri);
const mongoTest = safeMongo ? test : test.skip;

mongoTest("HTTP cancelled webhook releases stock once even when delivered twice", async () => {
  await mongoose.connect(mongoUri, {
    dbName: `webhook_http_cancel_${process.pid}_${Date.now()}`,
    serverSelectionTimeoutMS: 5000
  });
  try {
    const seller = new mongoose.Types.ObjectId();
    const product = await Product.create({
      seller, name: "Produto reservado", slug: `webhook-cancel-${Date.now()}`,
      description: "Produto para teste isolado", price: 100,
      stock: 2, reservedStock: 1
    });
    const order = await Order.create({
      buyer: new mongoose.Types.ObjectId(),
      buyerSnapshot: { name: "Comprador", email: "buyer@example.test" },
      shippingAddress: {
        recipientName: "Comprador", phone: "91999999999", zipCode: "66000000",
        street: "Rua Teste", number: "1", neighborhood: "Centro",
        city: "Belém", state: "PA"
      },
      items: [{
        product: product._id, seller, name: "Produto reservado",
        quantity: 1, unitPrice: 100, total: 100,
        platformFeePercent: 10, platformFeeAmount: 10, sellerAmount: 90
      }],
      subtotal: 100, total: 100, platformFeeTotal: 10, sellerTotal: 90,
      stockReservation: { reserved: true, reservedAt: new Date() },
      paymentStatus: "pending"
    });
    await withWebhook({
      orderId, externalReference: String(order._id),
      normalizedStatus: "cancelled", status: "expired",
      payment: { id: "PAY-CANCEL-TEST" }
    }, async send => {
      assert.equal((await send()).status, 200);
      assert.equal((await send()).status, 200);
    });
    const updatedOrder = await Order.findById(order._id);
    const updatedProduct = await Product.findById(product._id);
    assert.equal(updatedOrder.paymentStatus, "cancelled");
    assert.equal(updatedOrder.stockReservation.reserved, false);
    assert.ok(updatedOrder.stockReservation.releasedAt);
    assert.equal(updatedProduct.stock, 2);
    assert.equal(updatedProduct.reservedStock, 0);
    assert.equal(updatedProduct.sales, 0);
  } finally {
    if (mongoose.connection.readyState === 1) await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});

mongoTest("parallel HTTP approval and cancellation preserve a single inventory outcome", async () => {
  await mongoose.connect(mongoUri, {
    dbName: `webhook_http_race_${process.pid}_${Date.now()}`,
    serverSelectionTimeoutMS: 5000
  });
  try {
    const seller = new mongoose.Types.ObjectId();
    const product = await Product.create({
      seller, name: "Produto concorrente", slug: `webhook-race-${Date.now()}`,
      description: "Produto para concorrência HTTP", price: 100,
      stock: 2, reservedStock: 1
    });
    const order = await Order.create({
      buyer: new mongoose.Types.ObjectId(),
      buyerSnapshot: { name: "Comprador", email: "buyer@example.test" },
      shippingAddress: {
        recipientName: "Comprador", phone: "91999999999", zipCode: "66000000",
        street: "Rua Teste", number: "1", neighborhood: "Centro",
        city: "Belém", state: "PA"
      },
      items: [{
        product: product._id, seller, name: "Produto concorrente",
        quantity: 1, unitPrice: 100, total: 100,
        platformFeePercent: 10, platformFeeAmount: 10, sellerAmount: 90
      }],
      subtotal: 100, total: 100, platformFeeTotal: 10, sellerTotal: 90,
      stockReservation: { reserved: true, reservedAt: new Date() },
      paymentStatus: "pending"
    });
    await withWebhook(call => ({
      orderId, externalReference: String(order._id),
      normalizedStatus: call === 1 ? "approved" : "cancelled",
      status: call === 1 ? "approved" : "cancelled",
      payment: { id: "PAY-RACE-TEST" }
    }), async send => {
      const responses = await Promise.all([send(), send()]);
      assert.ok(responses.every(response => [200, 500].includes(response.status)));
    });
    const updatedOrder = await Order.findById(order._id);
    const updatedProduct = await Product.findById(product._id);
    assert.equal(updatedOrder.stockReservation.reserved, false);
    assert.equal(updatedProduct.reservedStock, 0);
    if (updatedOrder.paymentStatus === "paid") {
      assert.equal(updatedProduct.stock, 1);
      assert.equal(updatedProduct.sales, 1);
    } else {
      assert.equal(updatedOrder.paymentStatus, "cancelled");
      assert.equal(updatedProduct.stock, 2);
      assert.equal(updatedProduct.sales, 0);
    }
  } finally {
    if (mongoose.connection.readyState === 1) await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});

mongoTest("late approved charge on cancelled order returns retryable error without consuming stock", async () => {
  await mongoose.connect(mongoUri, {
    dbName: `webhook_late_approval_${process.pid}_${Date.now()}`,
    serverSelectionTimeoutMS: 5000
  });
  try {
    const seller = new mongoose.Types.ObjectId();
    const product = await Product.create({
      seller, name: "Produto encerrado", slug: `late-approval-${Date.now()}`,
      description: "Teste de reconciliação", price: 100, stock: 2, reservedStock: 0
    });
    const order = await Order.create({
      buyer: new mongoose.Types.ObjectId(),
      buyerSnapshot: { name: "Comprador", email: "buyer@example.test" },
      shippingAddress: {
        recipientName: "Comprador", phone: "91999999999", zipCode: "66000000",
        street: "Rua Teste", number: "1", neighborhood: "Centro",
        city: "Belém", state: "PA"
      },
      items: [{
        product: product._id, seller, name: "Produto encerrado",
        quantity: 1, unitPrice: 100, total: 100,
        platformFeePercent: 10, platformFeeAmount: 10, sellerAmount: 90
      }],
      subtotal: 100, total: 100, platformFeeTotal: 10, sellerTotal: 90,
      stockReservation: { reserved: false, releasedAt: new Date() },
      paymentStatus: "cancelled",
      payment: { providerOrderId: orderId }
    });
    await withWebhook({
      orderId, externalReference: String(order._id),
      normalizedStatus: "approved", status: "approved",
      payment: { id: "PAY-LATE-APPROVAL" }
    }, async send => {
      assert.equal((await send()).status, 500);
      assert.equal((await send()).status, 500);
    });
    const incidents = await FinancialReconciliationIncident.find({ order: order._id });
    assert.equal(incidents.length, 1);
    assert.equal(incidents[0].status, "pending");
    assert.equal(incidents[0].occurrences, 2);
    assert.equal(incidents[0].providerOrderId, orderId);
    const updatedOrder = await Order.findById(order._id);
    const updatedProduct = await Product.findById(product._id);
    assert.equal(updatedOrder.paymentStatus, "cancelled");
    assert.equal(updatedOrder.payment.processedAt, null);
    assert.equal(updatedProduct.stock, 2);
    assert.equal(updatedProduct.reservedStock, 0);
    assert.equal(updatedProduct.sales, 0);
  } finally {
    if (mongoose.connection.readyState === 1) await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});
