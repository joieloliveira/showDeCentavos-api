import mongoose from "mongoose";

const schema = new mongoose.Schema({
  auction: { type: mongoose.Schema.Types.ObjectId, ref: "Auction", required: true, unique: true },
  winner: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  product: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
  winningPriceCents: { type: Number, required: true, min: 0 },
  wonAt: { type: Date, required: true },
  paymentStatus: { type: String, enum: ["not_started", "pending", "paid", "failed", "refunded", "cancelled"], default: "not_started" },
  deliveryStatus: { type: String, enum: ["not_started", "preparing", "shipped", "delivered", "cancelled"], default: "not_started" },
}, { timestamps: true });

export default mongoose.models.AuctionFulfillment || mongoose.model("AuctionFulfillment", schema);
