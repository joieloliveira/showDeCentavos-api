import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import express from "express";
import mongoose from "mongoose";
import MercadoPagoProvider from "../services/payments/MercadoPagoProvider.js";
import WalletDeposit from "../models/WalletDeposit.js";
import AuctionWinnerPayment from "../models/AuctionWinnerPayment.js";
import AuctionFulfillment from "../models/AuctionFulfillment.js";
import Order from "../models/Order.js";
import { mercadoPagoOrderWebhook } from "../controllers/webhooks/MercadoPagoWebhookController.js";

const uri = process.env.WALLET_TEST_MONGODB_URI || "";
const safe = /^mongodb:\/\/127\.0\.0\.1:27018\/wallet_test_pix\?/.test(uri) &&
  /(?:\?|&)replicaSet=walletTestRS(?:&|$)/.test(uri) &&
  !/@|authSource=|directConnection=/.test(uri);
const secret = "auction-domain-isolation-test";
const requestId = "domain-isolation-request";
const dbName = `auction_domain_isolation_${process.pid}_${Date.now()}`;

function headers(id) {
  const ts = String(Math.floor(Date.now() / 1000));
  const v1 = crypto.createHmac("sha256", secret)
    .update(`id:${id};request-id:${requestId};ts:${ts};`).digest("hex");
  return { "content-type": "application/json", "x-request-id": requestId, "x-signature": `ts=${ts},v1=${v1}` };
}
async function withServer(fn) {
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
async function send(url, id) {
  return fetch(url, { method: "POST", headers: headers(id),
    body: JSON.stringify({ type: "order", data: { id } }) });
}

if (!safe) {
  test("financial domain isolation requires isolated replica set", { skip: "Set WALLET_TEST_MONGODB_URI to walletTestRS:27018" }, () => {});
} else {
  test("signed wallet webhook remains in wallet domain without changing auction payment", async () => {
    await mongoose.connect(uri, { dbName, serverSelectionTimeoutMS: 5000 });
    const originalGetOrder = MercadoPagoProvider.getOrder;
    const oldSecret = process.env.MERCADOPAGO_WEBHOOK_SECRET;
    const oldFlag = process.env.AUCTION_WINNER_PIX_WEBHOOK_ENABLED;
    try {
      const user = new mongoose.Types.ObjectId();
      const auction = new mongoose.Types.ObjectId();
      const fulfillment = await AuctionFulfillment.create({
        auction, winner: user, product: new mongoose.Types.ObjectId(),
        winningPriceCents: 175, wonAt: new Date(), paymentStatus: "pending",
      });
      const auctionPayment = await AuctionWinnerPayment.create({
        auction, fulfillment: fulfillment._id, winner: user, amountCents: 175,
        status: "pending", providerOrderId: "AUCTION-ORDER",
      });
      const deposit = await WalletDeposit.create({
        user, amountCents: 300, status: "pending", provider: "mercadopago",
      });
      process.env.MERCADOPAGO_WEBHOOK_SECRET = secret;
      process.env.AUCTION_WINNER_PIX_WEBHOOK_ENABLED = "true";
      MercadoPagoProvider.getOrder = async id => ({
        orderId: String(id), externalReference: String(deposit._id),
        normalizedStatus: "pending", status: "pending",
      });
      await withServer(async url => {
        assert.equal((await send(url, "WALLET-ORDER")).status, 200);
      });
      const walletAfter = await WalletDeposit.findById(deposit._id);
      assert.equal(walletAfter.providerOrderId, "WALLET-ORDER");
      assert.equal(walletAfter.status, "pending");
      assert.equal((await AuctionWinnerPayment.findById(auctionPayment._id)).status, "pending");
      assert.equal((await AuctionFulfillment.findById(fulfillment._id)).paymentStatus, "pending");
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

  test("unknown signed external reference does not create payments in any domain", async () => {
    await mongoose.connect(uri, { dbName: dbName + "_unknown", serverSelectionTimeoutMS: 5000 });
    const originalGetOrder = MercadoPagoProvider.getOrder;
    const oldSecret = process.env.MERCADOPAGO_WEBHOOK_SECRET;
    try {
      const unknown = new mongoose.Types.ObjectId();
      process.env.MERCADOPAGO_WEBHOOK_SECRET = secret;
      MercadoPagoProvider.getOrder = async id => ({
        orderId: String(id), externalReference: String(unknown),
        normalizedStatus: "pending", status: "pending",
      });
      await withServer(async url => {
        assert.equal((await send(url, "UNKNOWN-ORDER")).status, 200);
      });
      assert.equal(await AuctionWinnerPayment.countDocuments(), 0);
      assert.equal(await WalletDeposit.countDocuments(), 0);
      assert.equal(await Order.countDocuments(), 0);
    } finally {
      MercadoPagoProvider.getOrder = originalGetOrder;
      if (oldSecret === undefined) delete process.env.MERCADOPAGO_WEBHOOK_SECRET;
      else process.env.MERCADOPAGO_WEBHOOK_SECRET = oldSecret;
      await mongoose.connection.dropDatabase();
      await mongoose.disconnect();
    }
  });
}
