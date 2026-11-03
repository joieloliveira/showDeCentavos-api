import test from "node:test";
import assert from "node:assert/strict";
import Auction from "../models/Auction.js";
import AuctionFulfillment from "../models/AuctionFulfillment.js";
import WalletPaymentIncident from "../models/WalletPaymentIncident.js";
import { getAuctionOperationsSummary } from "../controllers/adminAuctionOperationsController.js";

test("operations summary reports real collection counts without revenue or personal data", async () => {
  const originalAuctions = Auction.aggregate;
  const originalPayments = AuctionFulfillment.aggregate;
  const originalIncidents = WalletPaymentIncident.countDocuments;
  const originalFulfillmentCount = AuctionFulfillment.countDocuments;
  let fulfillmentCalls = 0;
  try {
    Auction.aggregate = async () => [{ _id: "active", count: 3 }, { _id: "finished", count: 8 }];
    AuctionFulfillment.aggregate = async pipeline => {
      fulfillmentCalls++;
      const field = pipeline[0].$group._id;
      if (field === "$paymentStatus") return [{ _id: "paid", count: 4 }, { _id: "pending", count: 2 }];
      if (field === "$deliveryStatus") return [{ _id: "shipped", count: 1 }, { _id: "delivered", count: 2 }];
      throw new Error("Unexpected aggregation");
    };
    AuctionFulfillment.countDocuments = async filter => {
      if (filter.wonAt?.$lt) { assert.ok(filter.wonAt.$lt instanceof Date); return 7; }
      if (filter.addressSubmittedAt === null) return 2;
      if (filter.addressSubmittedAt?.$ne === null) return 4;
      if (filter.deliveryStatus === "preparing") return 3;
      if (filter.deliveryStatus === "shipped") return 1;
      throw new Error("Unexpected fulfillment count filter");
    };
    WalletPaymentIncident.countDocuments = async filter => {
      assert.deepEqual(filter, { resolution: "review_required" });
      return 5;
    };
    const headers = {};
    const response = {
      set: (name, value) => { headers[name] = value; },
      json: body => { response.body = body; return response; },
      status: code => { response.statusCode = code; return response; }
    };
    await getAuctionOperationsSummary({}, response);
    assert.equal(response.statusCode, undefined);
    assert.equal(headers["Cache-Control"], "no-store");
    assert.equal(response.body.auctions.active, 3);
    assert.equal(response.body.auctions.scheduled, 0);
    assert.equal(response.body.payments.paid, 4);
    assert.equal(response.body.payments.pending, 2);
    assert.equal(response.body.deliveries.shipped, 1);
    assert.equal(response.body.deliveries.delivered, 2);
    assert.equal(response.body.incidentsRequiringReview, 5);
    assert.equal(fulfillmentCalls, 2);
    assert.deepEqual(response.body.fulfillmentAlerts, {
      overduePayments: 7, readyForPreparation: 4, awaitingAddress: 2,
      preparingDeliveries: 3, shippedDeliveries: 1
    });
    assert.equal("revenue" in response.body, false);
    assert.equal("users" in response.body, false);
  } finally {
    Auction.aggregate = originalAuctions;
    AuctionFulfillment.aggregate = originalPayments;
    WalletPaymentIncident.countDocuments = originalIncidents;
    AuctionFulfillment.countDocuments = originalFulfillmentCount;
  }
});
