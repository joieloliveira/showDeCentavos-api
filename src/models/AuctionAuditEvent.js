import mongoose from "mongoose";

const schema = new mongoose.Schema({
  auction: { type: mongoose.Schema.Types.ObjectId, ref: "Auction", required: true, index: true },
  eventType: { type: String, enum: ["created", "waiting_started", "activated", "finished"], required: true },
  occurredAt: { type: Date, required: true },
  source: { type: String, enum: ["admin", "scheduler"], required: true },
  actor: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
}, { timestamps: true, versionKey: false });
schema.index({ auction: 1, eventType: 1 }, { unique: true });
schema.index({ auction: 1, occurredAt: 1 });
export default mongoose.models.AuctionAuditEvent || mongoose.model("AuctionAuditEvent", schema);
