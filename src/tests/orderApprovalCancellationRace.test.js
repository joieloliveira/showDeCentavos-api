import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import Order from "../models/Order.js";
import Product from "../models/Product.js";
import { processApprovedOrder } from "../services/OrderPaymentService.js";
import { canCancelReservedOrder } from "../services/payments/orderWebhookStateGuard.js";

const uri = process.env.WALLET_TEST_MONGODB_URI || "";
const safe = /^mongodb:\/\/127\.0\.0\.1:27018\/wallet_test_pix\?/.test(uri) &&
  /(?:\?|&)replicaSet=walletTestRS(?:&|$)/.test(uri) &&
  !/@|authSource=|directConnection=/.test(uri);
const integration = safe ? test : test.skip;

integration("concurrent approval and cancellation never double-consume or release reserved stock", async () => {
  await mongoose.connect(uri, {
    dbName: `order_race_${process.pid}_${Date.now()}`, serverSelectionTimeoutMS: 5000
  });
  try {
    const seller = new mongoose.Types.ObjectId(), buyer = new mongoose.Types.ObjectId();
    const product = await Product.create({
      seller, name: "Produto de teste", slug: `race-${Date.now()}`,
      description: "Teste isolado de concorrência", price: 100,
      stock: 2, reservedStock: 1
    });
    const order = await Order.create({
      buyer, buyerSnapshot: { name: "Comprador", email: "buyer@example.test" },
      shippingAddress: {
        recipientName: "Comprador", phone: "91999999999", zipCode: "66000000",
        street: "Rua Teste", number: "1", neighborhood: "Centro",
        city: "Belém", state: "PA"
      },
      items: [{
        product: product._id, seller, name: "Produto de teste", quantity: 1,
        unitPrice: 100, total: 100, platformFeePercent: 10,
        platformFeeAmount: 10, sellerAmount: 90
      }],
      subtotal: 100, total: 100, platformFeeTotal: 10, sellerTotal: 90,
      stockReservation: { reserved: true, reservedAt: new Date() },
      paymentStatus: "pending"
    });
    const providerOrder = { orderId: "ORD-RACE", normalizedStatus: "approved", payment: { id: "PIX-RACE" } };
    async function cancel() {
      const session = await mongoose.startSession();
      try {
        await session.withTransaction(async () => {
          const current = await Order.findById(order._id).session(session);
          if (!canCancelReservedOrder(current) || !current.stockReservation?.reserved) return;
          const result = await Product.updateOne(
            { _id: product._id, reservedStock: { $gte: 1 } },
            { $inc: { reservedStock: -1 } }, { session }
          );
          assert.equal(result.modifiedCount, 1);
          current.stockReservation.reserved = false;
          current.stockReservation.releasedAt = new Date();
          current.paymentStatus = "cancelled";
          await current.save({ session });
        });
      } finally { await session.endSession(); }
    }
    const results = await Promise.allSettled([
      processApprovedOrder({ internalOrderId: order._id, providerOrder }), cancel()
    ]);
    // Concurrent MongoDB writes can produce a transient transaction conflict.
    // The winning committed transition must always leave consistent inventory.
    const finalOrder = await Order.findById(order._id);
    const finalProduct = await Product.findById(product._id);
    assert.equal(finalOrder.stockReservation.reserved, false);
    assert.equal(finalProduct.reservedStock, 0);
    if (finalOrder.paymentStatus === "paid") {
      assert.equal(finalProduct.stock, 1);
      assert.equal(finalProduct.sales, 1);
    } else {
      assert.equal(finalOrder.paymentStatus, "cancelled");
      assert.equal(finalProduct.stock, 2);
      assert.equal(finalProduct.sales, 0);
    }
    assert.ok(results.some(result => result.status === "fulfilled"));
  } finally {
    if (mongoose.connection.readyState === 1) await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});
