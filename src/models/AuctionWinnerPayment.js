import mongoose from "mongoose";

// Dedicated auction charge ledger. No checkout or webhook writes to this model yet.
const schema = new mongoose.Schema({
  auction: { type: mongoose.Schema.Types.ObjectId, ref: "Auction", required: true, unique: true },
  fulfillment: { type: mongoose.Schema.Types.ObjectId, ref: "AuctionFulfillment", required: true, unique: true },
  winner: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  amountCents: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
  currency: { type: String, enum: ["BRL"], required: true, default: "BRL" },
  provider: { type: String, enum: ["mercadopago"], required: true, default: "mercadopago" },
  providerOrderId: { type: String, trim: true, default: null },
  providerPaymentId: { type: String, trim: true, default: null },
  status: { type: String, enum: ["not_started", "pending", "paid", "failed", "refunded", "cancelled"], default: "not_started" },
  processedAt: { type: Date, default: null }
}, { timestamps: true });

schema.index({ provider: 1, providerOrderId: 1 }, {
  unique: true, partialFilterExpression: { providerOrderId: { $type: "string" } }
});
schema.index({ provider: 1, providerPaymentId: 1 }, {
  unique: true, partialFilterExpression: { providerPaymentId: { $type: "string" } }
});

export default mongoose.models.AuctionWinnerPayment || mongoose.model("AuctionWinnerPayment", schema);
