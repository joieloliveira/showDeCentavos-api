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
const dbName = `auction_pix_race_${process.pid}_${Date.now()}`;
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
  const providerOrder = {
    orderId: String(auction), externalReference: String(payment._id),
    normalizedStatus: "approved", totalAmountCents: 175,
    payment: { id: `pix-${auction}`, paymentMethodId: "pix" },
    transactions: [{ id: `pix-${auction}`, status: "approved", paymentMethodId: "pix", amountCents: 175 }]
  };
  return { payment, fulfillment, providerOrder };
}
if (!safe) {
  test("concurrency tests require local replica set", { skip: "Set WALLET_TEST_MONGODB_URI to local walletTestRS:27018" }, () => {});
} else {
  test("two simultaneous confirmations yield one committed payment", async () => {
    await mongoose.connect(uri, { dbName, serverSelectionTimeoutMS: 5000 });
    try {
      const { payment, fulfillment, providerOrder } = await fixture();
      const results = await Promise.allSettled([
        processVerifiedAuctionPix({ paymentId: String(payment._id), providerOrder }),
        processVerifiedAuctionPix({ paymentId: String(payment._id), providerOrder })
      ]);
      const successes = results.filter(result => result.status === "fulfilled" && result.value.processed);
      assert.equal(successes.length, 1, JSON.stringify(results.map(r => r.status === "fulfilled" ? r.value : String(r.reason))));
      const finalPayment = await AuctionWinnerPayment.findById(payment._id).lean();
      const finalFulfillment = await AuctionFulfillment.findById(fulfillment._id).lean();
      assert.equal(finalPayment.status, "paid");
      assert.ok(finalPayment.processedAt);
      assert.equal(finalFulfillment.paymentStatus, "paid");
      assert.equal(await AuctionWinnerPayment.countDocuments({ auction: payment.auction }), 1);
    } finally {
      await mongoose.connection.dropDatabase();
      await mongoose.disconnect();
    }
  });

  test("forced fulfillment write failure rolls back payment confirmation", async () => {
    await mongoose.connect(uri, { dbName: dbName + "_rollback", serverSelectionTimeoutMS: 5000 });
    const originalUpdate = AuctionFulfillment.updateOne;
    try {
      const { payment, fulfillment, providerOrder } = await fixture();
      AuctionFulfillment.updateOne = async () => { throw new Error("Simulated fulfillment ledger failure"); };
      await assert.rejects(
        processVerifiedAuctionPix({ paymentId: String(payment._id), providerOrder }),
        /Simulated fulfillment ledger failure/
      );
      const afterPayment = await AuctionWinnerPayment.findById(payment._id).lean();
      const afterFulfillment = await AuctionFulfillment.findById(fulfillment._id).lean();
      assert.equal(afterPayment.status, "pending");
      assert.equal(afterPayment.processedAt, null);
      assert.equal(afterPayment.providerPaymentId, null);
      assert.equal(afterFulfillment.paymentStatus, "pending");
    } finally {
      AuctionFulfillment.updateOne = originalUpdate;
      await mongoose.connection.dropDatabase();
      await mongoose.disconnect();
    }
  });
}
