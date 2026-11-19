import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import AuctionWinnerPayment from "../models/AuctionWinnerPayment.js";
import AuctionFulfillment from "../models/AuctionFulfillment.js";
import MercadoPagoProvider from "../services/payments/MercadoPagoProvider.js";
import { routeAuctionPixWebhook } from "../services/AuctionPixWebhookRouter.js";

const uri = process.env.WALLET_TEST_MONGODB_URI || "";
const safe = /^mongodb:\/\/127\.0\.0\.1:27018\/wallet_test_pix\?/.test(uri) &&
  /(?:\?|&)replicaSet=walletTestRS(?:&|$)/.test(uri) &&
  !/@|authSource=|directConnection=/.test(uri);
const dbName = `auction_webhook_integration_${process.pid}_${Date.now()}`;

async function seed() {
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
  const providerOrder = {
    orderId: String(auction), externalReference: String(payment._id),
    normalizedStatus: "approved", payment: { id: `PIX-${auction}`, method: "pix" },
    raw: { total_amount: "1.75", transactions: { payments: [{
      id: `PIX-${auction}`, amount: "1.75", status: "processed",
      payment_method: { id: "pix" },
    }] } },
  };
  return { payment, fulfillment, providerOrder };
}

if (!safe) {
  test("webhook integration requires isolated local replica set", { skip: "Configure WALLET_TEST_MONGODB_URI for walletTestRS:27018" }, () => {});
} else {
  test("webhook routing independently verifies and commits auction PIX once", async () => {
    await mongoose.connect(uri, { dbName, serverSelectionTimeoutMS: 5000 });
    const oldFlag = process.env.AUCTION_WINNER_PIX_WEBHOOK_ENABLED;
    const oldGetOrder = MercadoPagoProvider.getOrder;
    try {
      const { payment, fulfillment, providerOrder } = await seed();
      let remoteReads = 0;
      MercadoPagoProvider.getOrder = async (orderId) => {
        remoteReads++;
        assert.equal(orderId, providerOrder.orderId);
        return providerOrder;
      };
      delete process.env.AUCTION_WINNER_PIX_WEBHOOK_ENABLED;
      assert.deepEqual(await routeAuctionPixWebhook({
        externalReference: String(payment._id), providerOrderId: providerOrder.orderId,
      }), { matched: true, processed: false, reason: "FEATURE_DISABLED" });
      assert.equal(remoteReads, 0);
      assert.equal((await AuctionWinnerPayment.findById(payment._id)).status, "pending");

      process.env.AUCTION_WINNER_PIX_WEBHOOK_ENABLED = "true";
      const first = await routeAuctionPixWebhook({
        externalReference: String(payment._id), providerOrderId: providerOrder.orderId,
      });
      assert.equal(first.matched, true);
      assert.equal(first.processed, true);
      assert.equal(remoteReads, 1);
      assert.equal((await AuctionWinnerPayment.findById(payment._id)).status, "paid");
      assert.equal((await AuctionFulfillment.findById(fulfillment._id)).paymentStatus, "paid");

      const replay = await routeAuctionPixWebhook({
        externalReference: String(payment._id), providerOrderId: providerOrder.orderId,
      });
      assert.equal(replay.processed, false);
      assert.equal(replay.reason, "ALREADY_PROCESSED");
      assert.equal(remoteReads, 1);
    } finally {
      MercadoPagoProvider.getOrder = oldGetOrder;
      if (oldFlag === undefined) delete process.env.AUCTION_WINNER_PIX_WEBHOOK_ENABLED;
      else process.env.AUCTION_WINNER_PIX_WEBHOOK_ENABLED = oldFlag;
      await mongoose.connection.dropDatabase();
      await mongoose.disconnect();
    }
  });

  test("untrusted provider response cannot confirm auction PIX", async () => {
    await mongoose.connect(uri, { dbName: dbName + "_rejected", serverSelectionTimeoutMS: 5000 });
    const oldFlag = process.env.AUCTION_WINNER_PIX_WEBHOOK_ENABLED;
    const oldGetOrder = MercadoPagoProvider.getOrder;
    try {
      const { payment, fulfillment, providerOrder } = await seed();
      process.env.AUCTION_WINNER_PIX_WEBHOOK_ENABLED = "true";
      MercadoPagoProvider.getOrder = async () => ({
        ...providerOrder, raw: { ...providerOrder.raw, total_amount: "9.99" },
      });
      const result = await routeAuctionPixWebhook({
        externalReference: String(payment._id), providerOrderId: providerOrder.orderId,
      });
      assert.equal(result.matched, true);
      assert.equal(result.processed, false);
      assert.equal(result.reason, "AMOUNT_MISMATCH");
      assert.equal((await AuctionWinnerPayment.findById(payment._id)).status, "pending");
      assert.equal((await AuctionFulfillment.findById(fulfillment._id)).paymentStatus, "pending");
    } finally {
      MercadoPagoProvider.getOrder = oldGetOrder;
      if (oldFlag === undefined) delete process.env.AUCTION_WINNER_PIX_WEBHOOK_ENABLED;
      else process.env.AUCTION_WINNER_PIX_WEBHOOK_ENABLED = oldFlag;
      await mongoose.connection.dropDatabase();
      await mongoose.disconnect();
    }
  });
}
