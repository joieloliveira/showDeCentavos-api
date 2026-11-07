import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import auctionRoutes from "../routes/auctionRoutes.js";
import AuctionFulfillment from "../models/AuctionFulfillment.js";
import AuctionWinnerPayment from "../models/AuctionWinnerPayment.js";
import AuctionWinnerPixAttempt from "../models/AuctionWinnerPixAttempt.js";
import AuctionDeliveryAuditEvent from "../models/AuctionDeliveryAuditEvent.js";
import User from "../models/User.js";
import { processVerifiedAuctionPix } from "../services/AuctionWinnerPaymentService.js";

const uri = process.env.WALLET_TEST_MONGODB_URI || "";
const safe = /^mongodb:\/\/127\.0\.0\.1:27018\/wallet_test_pix\?/.test(uri) &&
  /(?:\?|&)replicaSet=walletTestRS(?:&|$)/.test(uri) &&
  !/@|authSource=|directConnection=/.test(uri);
const integration = safe ? test : test.skip;
const shippingAddress = {
  recipientName: "Pessoa Fictícia", phone: "91999999999", zipCode: "66000000",
  street: "Rua Fictícia", number: "10", neighborhood: "Centro", city: "Belém", state: "PA", country: "BR"
};
async function isolated(label, callback) {
  const oldSecret = process.env.JWT_SECRET;
  const oldDelivery = process.env.AUCTION_DELIVERY_MANAGEMENT_ENABLED;
  let server;
  try {
    process.env.JWT_SECRET = "isolated-payment-delivery-bridge";
    process.env.AUCTION_DELIVERY_MANAGEMENT_ENABLED = "true";
    await mongoose.connect(uri, {
      dbName: `auction_payment_delivery_${label}_${process.pid}_${Date.now()}`,
      serverSelectionTimeoutMS: 5000
    });
    const admin = await User.create({
      name: "Bridge Admin", email: `bridge-${label}-${Date.now()}@example.test`,
      role: "admin", isActive: true
    });
    const auction = new mongoose.Types.ObjectId();
    const winner = new mongoose.Types.ObjectId();
    const fulfillment = await AuctionFulfillment.create({
      auction, winner, product: new mongoose.Types.ObjectId(),
      winningPriceCents: 275, wonAt: new Date(),
      paymentStatus: "pending", deliveryStatus: "not_started",
      shippingAddress, addressSubmittedAt: new Date()
    });
    const payment = await AuctionWinnerPayment.create({
      auction, fulfillment: fulfillment._id, winner,
      amountCents: 275, status: "pending", providerOrderId: `ORDER-${label}`
    });
    await AuctionWinnerPixAttempt.create({
      auction, payment: payment._id, idempotencyKey: `auction-winner-pix-${auction}`,
      state: "reserved"
    });
    const providerOrder = {
      orderId: `ORDER-${label}`, externalReference: String(payment._id),
      normalizedStatus: "approved", totalAmountCents: 275,
      payment: { id: `PIX-${label}`, paymentMethodId: "pix" },
      transactions: [{ id: `PIX-${label}`, status: "approved", paymentMethodId: "pix", amountCents: 275 }]
    };
    const app = express();
    app.use(express.json());
    app.use("/api/auctions", auctionRoutes);
    server = app.listen(0, "127.0.0.1");
    await new Promise(resolve => server.once("listening", resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const token = jwt.sign({ id: String(admin._id), role: "admin" }, process.env.JWT_SECRET);
    const advance = async deliveryStatus => {
      const response = await fetch(`${base}/api/auctions/admin/fulfillments/${auction}/delivery`, {
        method: "PATCH", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ deliveryStatus })
      });
      return response.status;
    };
    await callback({ auction, fulfillment, payment, providerOrder, advance });
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    if (mongoose.connection.readyState === 1) await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    if (oldSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = oldSecret;
    if (oldDelivery === undefined) delete process.env.AUCTION_DELIVERY_MANAGEMENT_ENABLED;
    else process.env.AUCTION_DELIVERY_MANAGEMENT_ENABLED = oldDelivery;
  }
}

integration("delivery stays blocked until the same verified PIX commits payment and fulfillment", async () => {
  await isolated("confirmed", async ({ auction, fulfillment, payment, providerOrder, advance }) => {
    assert.equal(await advance("preparing"), 409);
    assert.equal((await processVerifiedAuctionPix({ paymentId: payment._id, providerOrder })).processed, true);
    assert.equal((await processVerifiedAuctionPix({ paymentId: payment._id, providerOrder })).processed, false);
    assert.equal((await AuctionWinnerPayment.findById(payment._id)).status, "paid");
    assert.equal((await AuctionFulfillment.findById(fulfillment._id)).paymentStatus, "paid");
    assert.equal((await AuctionWinnerPixAttempt.findOne({ payment: payment._id })).state, "provider_confirmed");
    assert.equal(await advance("preparing"), 200);
    assert.equal(await advance("preparing"), 409);
    assert.equal(await advance("shipped"), 200);
    assert.equal(await advance("delivered"), 200);
    assert.equal((await AuctionFulfillment.findById(fulfillment._id)).deliveryStatus, "delivered");
    assert.equal(await AuctionDeliveryAuditEvent.countDocuments({ auction }), 3);
  });
});

integration("mismatched PIX identity cannot unlock delivery or create audit events", async () => {
  await isolated("mismatch", async ({ auction, fulfillment, payment, providerOrder, advance }) => {
    providerOrder.externalReference = String(new mongoose.Types.ObjectId());
    assert.equal((await processVerifiedAuctionPix({ paymentId: payment._id, providerOrder })).processed, false);
    assert.equal(await advance("preparing"), 409);
    assert.equal((await AuctionWinnerPayment.findById(payment._id)).status, "pending");
    assert.equal((await AuctionFulfillment.findById(fulfillment._id)).paymentStatus, "pending");
    assert.equal((await AuctionWinnerPixAttempt.findOne({ payment: payment._id })).state, "reserved");
    assert.equal(await AuctionDeliveryAuditEvent.countDocuments({ auction }), 0);
  });
});
