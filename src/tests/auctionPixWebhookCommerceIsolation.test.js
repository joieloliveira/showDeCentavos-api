import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import express from "express";
import mongoose from "mongoose";
import MercadoPagoProvider from "../services/payments/MercadoPagoProvider.js";
import Order from "../models/Order.js";
import AuctionWinnerPayment from "../models/AuctionWinnerPayment.js";
import AuctionFulfillment from "../models/AuctionFulfillment.js";
import WalletDeposit from "../models/WalletDeposit.js";
import { mercadoPagoOrderWebhook } from "../controllers/webhooks/MercadoPagoWebhookController.js";

const uri = process.env.WALLET_TEST_MONGODB_URI || "";
const safe = /^mongodb:\/\/127\.0\.0\.1:27018\/wallet_test_pix\?/.test(uri) &&
  /(?:\?|&)replicaSet=walletTestRS(?:&|$)/.test(uri) &&
  !/@|authSource=|directConnection=/.test(uri);
const secret = "isolated-commerce-domain-secret";
const requestId = "commerce-isolation-test";
const dbName = `auction_commerce_isolation_${process.pid}_${Date.now()}`;

async function serve(fn) {
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
  const ts = String(Math.floor(Date.now() / 1000));
  const v1 = crypto.createHmac("sha256", secret)
    .update(`id:${id};request-id:${requestId};ts:${ts};`).digest("hex");
  return fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-request-id": requestId,
      "x-signature": `ts=${ts},v1=${v1}`,
    },
    body: JSON.stringify({ type: "order", data: { id } }),
  });
}

if (!safe) {
  test("commerce domain isolation requires isolated walletTestRS", { skip: "Set WALLET_TEST_MONGODB_URI for local walletTestRS:27018" }, () => {});
} else {
  test("signed pending commerce order stays in commerce domain without changing auction or wallet", async () => {
    await mongoose.connect(uri, { dbName, serverSelectionTimeoutMS: 5000 });
    const oldGetOrder = MercadoPagoProvider.getOrder;
    const oldSecret = process.env.MERCADOPAGO_WEBHOOK_SECRET;
    const oldFlag = process.env.AUCTION_WINNER_PIX_WEBHOOK_ENABLED;
    try {
      const buyer = new mongoose.Types.ObjectId();
      const auction = new mongoose.Types.ObjectId();
      const fulfillment = await AuctionFulfillment.create({
        auction, winner: buyer, product: new mongoose.Types.ObjectId(),
        winningPriceCents: 175, wonAt: new Date(), paymentStatus: "pending",
      });
      const auctionPayment = await AuctionWinnerPayment.create({
        auction, fulfillment: fulfillment._id, winner: buyer, amountCents: 175,
        status: "pending", providerOrderId: "AUCTION-ISOLATION",
      });
      const wallet = await WalletDeposit.create({
        user: buyer, amountCents: 500, status: "pending", provider: "mercadopago",
      });
      const commerce = await Order.create({
        buyer, buyerSnapshot: { name: "Local Test Buyer", email: "buyer@example.invalid" },
        shippingAddress: {
          recipientName: "Local Test Buyer", phone: "00000000000", zipCode: "00000000",
          street: "Test Street", number: "1", neighborhood: "Test",
          city: "Test City", state: "PA", country: "BR",
        },
        items: [], platformFeeTotal: 0, sellerTotal: 0,
        subtotal: 200, shipping: 0, discount: 0, total: 200,
        paymentStatus: "pending", payment: { provider: "mercadopago" },
      });
      process.env.MERCADOPAGO_WEBHOOK_SECRET = secret;
      process.env.AUCTION_WINNER_PIX_WEBHOOK_ENABLED = "true";
      MercadoPagoProvider.getOrder = async id => ({
        orderId: String(id), externalReference: String(commerce._id),
        normalizedStatus: "pending", status: "pending",
      });
      await serve(async url => {
        assert.equal((await notify(url, "COMMERCE-PENDING-ORDER")).status, 200);
      });
      const updatedCommerce = await Order.findById(commerce._id);
      assert.equal(updatedCommerce.paymentStatus, "pending");
      assert.equal(updatedCommerce.payment.providerOrderId, "COMMERCE-PENDING-ORDER");
      assert.equal(updatedCommerce.payment.mercadoPagoOrderId, "COMMERCE-PENDING-ORDER");
      assert.equal((await AuctionWinnerPayment.findById(auctionPayment._id)).status, "pending");
      assert.equal((await AuctionFulfillment.findById(fulfillment._id)).paymentStatus, "pending");
      assert.equal((await WalletDeposit.findById(wallet._id)).status, "pending");
      assert.equal((await WalletDeposit.findById(wallet._id)).providerOrderId, null);
    } finally {
      MercadoPagoProvider.getOrder = oldGetOrder;
      if (oldSecret === undefined) delete process.env.MERCADOPAGO_WEBHOOK_SECRET;
      else process.env.MERCADOPAGO_WEBHOOK_SECRET = oldSecret;
      if (oldFlag === undefined) delete process.env.AUCTION_WINNER_PIX_WEBHOOK_ENABLED;
      else process.env.AUCTION_WINNER_PIX_WEBHOOK_ENABLED = oldFlag;
      await mongoose.connection.dropDatabase();
      await mongoose.disconnect();
    }
  });
}
