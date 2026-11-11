import mongoose from "mongoose";

const schema = new mongoose.Schema({
  auction: { type: mongoose.Schema.Types.ObjectId, ref: "Auction", required: true, index: true },
  actor: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  fromStatus: { type: String, enum: ["not_started", "preparing", "shipped"], required: true },
  toStatus: { type: String, enum: ["preparing", "shipped", "delivered"], required: true },
  occurredAt: { type: Date, required: true, default: Date.now },
}, { timestamps: true, versionKey: false });

schema.index({ auction: 1, toStatus: 1 }, { unique: true });
schema.index({ auction: 1, occurredAt: 1 });
export default mongoose.models.AuctionDeliveryAuditEvent ||
  mongoose.model("AuctionDeliveryAuditEvent", schema);
