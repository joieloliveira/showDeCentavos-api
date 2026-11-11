import mongoose from "mongoose";

const schema = new mongoose.Schema({
  incident: { type: mongoose.Schema.Types.ObjectId, ref: "FinancialReconciliationIncident", required: true, index: true },
  actor: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  source: { type: String, enum: ["admin", "system"], default: "admin", required: true },
  fromStatus: { type: String, required: true, enum: ["pending", "investigating", "resolved"] },
  toStatus: { type: String, required: true, enum: ["pending", "investigating", "resolved"] },
  note: { type: String, required: true, maxlength: 2000 },
}, { timestamps: true });
schema.index({ incident: 1, createdAt: -1 });
export default mongoose.model("FinancialIncidentAudit", schema);
