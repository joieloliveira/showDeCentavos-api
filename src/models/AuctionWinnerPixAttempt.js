import mongoose from "mongoose";

// One durable provider attempt per winner payment. An unknown provider outcome
// must be reconciled, never retried with a new key.
const schema = new mongoose.Schema({
  payment: { type: mongoose.Schema.Types.ObjectId, ref: "AuctionWinnerPayment", required: true, unique: true },
  auction: { type: mongoose.Schema.Types.ObjectId, ref: "Auction", required: true, unique: true },
  idempotencyKey: { type: String, required: true, unique: true, immutable: true },
  state: { type: String, enum: ["reserved", "request_unknown", "provider_confirmed", "reconciliation_required"], required: true, default: "reserved" },
  providerOrderId: { type: String, trim: true, default: null },
  lastError: { type: String, trim: true, default: null },
}, { timestamps: true });

schema.index({ providerOrderId: 1 }, {
  unique: true, partialFilterExpression: { providerOrderId: { $type: "string" } }
});

export default mongoose.models.AuctionWinnerPixAttempt ||
  mongoose.model("AuctionWinnerPixAttempt", schema);
