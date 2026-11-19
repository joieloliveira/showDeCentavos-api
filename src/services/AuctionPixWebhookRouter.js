import mongoose from "mongoose";
import AuctionWinnerPayment from "../models/AuctionWinnerPayment.js";
import AuctionFulfillment from "../models/AuctionFulfillment.js";
import { verifyAuctionPixWithProvider } from "./AuctionPixProviderVerificationService.js";
import { processVerifiedAuctionPix } from "./AuctionWinnerPaymentService.js";

// Called only after webhook signature validation and an independent provider lookup.
// Auction payments are never interpreted as wallet deposits or commerce orders.
export async function routeAuctionPixWebhook({ externalReference, providerOrderId }) {
  if (!mongoose.isObjectIdOrHexString(externalReference)) {
    return { matched: false };
  }
  const payment = await AuctionWinnerPayment.findById(externalReference);
  if (!payment) return { matched: false };

  // A known auction payment must never fall through to another financial flow.
  if (process.env.AUCTION_WINNER_PIX_WEBHOOK_ENABLED !== "true") {
    return { matched: true, processed: false, reason: "FEATURE_DISABLED" };
  }
  if (!providerOrderId || String(payment.providerOrderId) !== String(providerOrderId)) {
    return { matched: true, processed: false, reason: "ORDER_MISMATCH" };
  }
  if (payment.status === "paid" && payment.processedAt) {
    return { matched: true, processed: false, reason: "ALREADY_PROCESSED" };
  }
  const fulfillment = await AuctionFulfillment.findById(payment.fulfillment);
  const verification = await verifyAuctionPixWithProvider({ payment, fulfillment });
  if (!verification.accepted) {
    return { matched: true, processed: false, reason: verification.reason };
  }
  const result = await processVerifiedAuctionPix({
    paymentId: String(payment._id),
    providerOrder: verification.providerOrder,
  });
  return { matched: true, ...result };
}
