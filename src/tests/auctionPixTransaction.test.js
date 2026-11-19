import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import AuctionWinnerPayment from "../models/AuctionWinnerPayment.js";
import AuctionFulfillment from "../models/AuctionFulfillment.js";
import { processVerifiedAuctionPix } from "../services/AuctionWinnerPaymentService.js";

const uri = process.env.WALLET_TEST_MONGODB_URI || "";
const safe = /^mongodb:\/\/127\.0\.0\.1:27018\/wallet_test_pix\?/.test(uri) &&
  /(?:\?|&)replicaSet=walletTestRS(?:&|$)/.test(uri) &&
  !/@|authSource=|directConnection=/.test(uri);
const dbName = `auction_pix_tx_${process.pid}_${Date.now()}`;
const order = id => ({
  orderId: id, externalReference: "", normalizedStatus: "approved",
  totalAmountCents: 175, payment: { id: "pix-" + id, paymentMethodId: "pix" },
  transactions: [{ id: "pix-" + id, status: "approved", paymentMethodId: "pix", amountCents: 175 }]
});
async function fixture() {
  const auction = new mongoose.Types.ObjectId();
  const winner = new mongoose.Types.ObjectId();
  const fulfillment = await AuctionFulfillment.create({
    auction, winner, product: new mongoose.Types.ObjectId(),
    winningPriceCents: 175, wonAt: new Date(), paymentStatus: "pending"
  });
  const payment = await AuctionWinnerPayment.create({
    auction, fulfillment: fulfillment._id, winner,
    amountCents: 175, status: "pending", providerOrderId: String(auction)
  });
  return { payment, fulfillment, providerOrder: { ...order(String(auction)), externalReference: String(payment._id) } };
}
if (!safe) {
  test("transaction tests require safe local Mongo replica set", { skip: "Set WALLET_TEST_MONGODB_URI to local walletTestRS:27018" }, () => {});
} else {
  test("verified PIX updates payment and fulfillment exactly once", async () => {
    await mongoose.connect(uri, { dbName, serverSelectionTimeoutMS: 5000 });
    try {
      const { payment, fulfillment, providerOrder } = await fixture();
      const first = await processVerifiedAuctionPix({ paymentId: String(payment._id), providerOrder });
      assert.equal(first.processed, true);
      const second = await processVerifiedAuctionPix({ paymentId: String(payment._id), providerOrder });
      assert.equal(second.processed, false);
      assert.equal((await AuctionWinnerPayment.findById(payment._id)).status, "paid");
      assert.equal((await AuctionFulfillment.findById(fulfillment._id)).paymentStatus, "paid");
    } finally {
      await mongoose.connection.dropDatabase();
      await mongoose.disconnect();
    }
  });
  test("failed fulfillment transition rolls back payment claim", async () => {
    await mongoose.connect(uri, { dbName: dbName + "_rollback", serverSelectionTimeoutMS: 5000 });
    try {
      const { payment, fulfillment, providerOrder } = await fixture();
      await AuctionFulfillment.updateOne({ _id: fulfillment._id }, { $set: { paymentStatus: "failed" } });
      const result = await processVerifiedAuctionPix({ paymentId: String(payment._id), providerOrder });
      assert.equal(result.processed, false);
      assert.equal((await AuctionWinnerPayment.findById(payment._id)).status, "pending");
      assert.equal((await AuctionFulfillment.findById(fulfillment._id)).paymentStatus, "failed");
    } finally {
      await mongoose.connection.dropDatabase();
      await mongoose.disconnect();
    }
  });
}
