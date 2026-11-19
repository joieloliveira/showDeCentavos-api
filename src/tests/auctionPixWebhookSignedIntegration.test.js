import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import express from "express";
import mongoose from "mongoose";
import MercadoPagoProvider from "../services/payments/MercadoPagoProvider.js";
import AuctionWinnerPayment from "../models/AuctionWinnerPayment.js";
import AuctionFulfillment from "../models/AuctionFulfillment.js";
import { mercadoPagoOrderWebhook } from "../controllers/webhooks/MercadoPagoWebhookController.js";

const uri = process.env.WALLET_TEST_MONGODB_URI || "";
const safe = /^mongodb:\/\/127\.0\.0\.1:27018\/wallet_test_pix\?/.test(uri) &&
  /(?:\?|&)replicaSet=walletTestRS(?:&|$)/.test(uri) &&
  !/@|authSource=|directConnection=/.test(uri);
const secret = "isolated-auction-http-test-secret";
const requestId = "auction-http-request";
const dbName = `auction_http_pix_${process.pid}_${Date.now()}`;

function headers(id) {
  const ts = String(Math.floor(Date.now() / 1000));
  const manifest = `id:${id};request-id:${requestId};ts:${ts};`;
  const v1 = crypto.createHmac("sha256", secret).update(manifest).digest("hex");
  return { "content-type": "application/json", "x-request-id": requestId, "x-signature": `ts=${ts},v1=${v1}` };
}
async function serverRun(fn) {
  const app = express();
  app.use(express.json());
  app.post("/webhook", mercadoPagoOrderWebhook);
  const server = app.listen(0, "127.0.0.1");
  try {
    if (!server.listening) await new Promise((resolve, reject) => {
      server.once("listening", resolve); server.once("error", reject);
    });
    await fn(`http://127.0.0.1:${server.address().port}/webhook`);
  } finally {
    await new Promise((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
  }
}
async function notify(url, id) {
  return fetch(url, { method: "POST", headers: headers(id), body: JSON.stringify({ type: "order", data: { id } }) });
}
async function fixture() {
  const auction = new mongoose.Types.ObjectId();
  const winner = new mongoose.Types.ObjectId();
  const fulfillment = await AuctionFulfillment.create({
    auction, winner, product: new mongoose.Types.ObjectId(),
    winningPriceCents: 175, wonAt: new Date(), paymentStatus: "pending",
  });
  const payment = await AuctionWinnerPayment.create({
    auction, fulfillment: fulfillment._id, winner, amountCents: 175,
    status: "pending", providerOrderId: String(auction),
  });
  const order = {
    orderId: String(auction), externalReference: String(payment._id),
    normalizedStatus: "approved", payment: { id: `PIX-${auction}`, method: "pix" },
    raw: { total_amount: "1.75", transactions: { payments: [{
      id: `PIX-${auction}`, amount: "1.75", status: "processed",
      payment_method: { id: "pix" },
    }] } },
  };
  return { payment, fulfillment, order };
}

if (!safe) {
  test("HTTP auction PIX requires isolated walletTestRS", { skip: "Set WALLET_TEST_MONGODB_URI to local walletTestRS:27018" }, () => {});
} else {
  test("signed HTTP notification confirms auction PIX once and replay remains idempotent", async () => {
    await mongoose.connect(uri, { dbName, serverSelectionTimeoutMS: 5000 });
    const oldSecret = process.env.MERCADOPAGO_WEBHOOK_SECRET;
    const oldFlag = process.env.AUCTION_WINNER_PIX_WEBHOOK_ENABLED;
    const originalGetOrder = MercadoPagoProvider.getOrder;
    try {
      const { payment, fulfillment, order } = await fixture();
      let reads = 0;
      MercadoPagoProvider.getOrder = async id => {
        assert.equal(String(id), order.orderId);
        reads++;
        return order;
      };
      process.env.MERCADOPAGO_WEBHOOK_SECRET = secret;
      delete process.env.AUCTION_WINNER_PIX_WEBHOOK_ENABLED;
      await serverRun(async url => {
        assert.equal((await notify(url, order.orderId)).status, 200);
        assert.equal((await AuctionWinnerPayment.findById(payment._id)).status, "pending");
        assert.equal((await AuctionFulfillment.findById(fulfillment._id)).paymentStatus, "pending");

        process.env.AUCTION_WINNER_PIX_WEBHOOK_ENABLED = "true";
        assert.equal((await notify(url, order.orderId)).status, 200);
        const paid = await AuctionWinnerPayment.findById(payment._id);
        assert.equal(paid.status, "paid");
        assert.ok(paid.processedAt);
        assert.equal((await AuctionFulfillment.findById(fulfillment._id)).paymentStatus, "paid");
        assert.equal((await notify(url, order.orderId)).status, 200);
        const replay = await AuctionWinnerPayment.findById(payment._id);
        assert.equal(replay.processedAt.getTime(), paid.processedAt.getTime());
      });
      assert.equal(reads, 4); // initial disabled: 1; confirmation: 2; replay: 1
    } finally {
      MercadoPagoProvider.getOrder = originalGetOrder;
      if (oldSecret === undefined) delete process.env.MERCADOPAGO_WEBHOOK_SECRET;
      else process.env.MERCADOPAGO_WEBHOOK_SECRET = oldSecret;
      if (oldFlag === undefined) delete process.env.AUCTION_WINNER_PIX_WEBHOOK_ENABLED;
      else process.env.AUCTION_WINNER_PIX_WEBHOOK_ENABLED = oldFlag;
      await mongoose.connection.dropDatabase();
      await mongoose.disconnect();
    }
  });
}
