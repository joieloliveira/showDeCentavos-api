import mongoose from "mongoose";

const schema = new mongoose.Schema({
  auction: { type: mongoose.Schema.Types.ObjectId, ref: "Auction", required: true, unique: true },
  winner: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  product: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
  winningPriceCents: { type: Number, required: true, min: 0 },
  wonAt: { type: Date, required: true },
  shippingAddress: {
    recipientName: { type: String, trim: true },
    phone: { type: String, trim: true },
    zipCode: { type: String, trim: true },
    street: { type: String, trim: true },
    number: { type: String, trim: true },
    complement: { type: String, trim: true, default: "" },
    neighborhood: { type: String, trim: true },
    city: { type: String, trim: true },
    state: { type: String, uppercase: true, trim: true },
    country: { type: String, default: "BR" }
  },
  addressSubmittedAt: { type: Date, default: null },
  paymentStatus: { type: String, enum: ["not_started", "pending", "paid", "failed", "refunded", "cancelled"], default: "not_started" },
  deliveryStatus: { type: String, enum: ["not_started", "preparing", "shipped", "delivered", "cancelled"], default: "not_started" },
}, { timestamps: true });

export default mongoose.models.AuctionFulfillment || mongoose.model("AuctionFulfillment", schema);
