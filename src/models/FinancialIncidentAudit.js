import mongoose from "mongoose";

const schema = new mongoose.Schema({
  incident: { type: mongoose.Schema.Types.ObjectId, ref: "FinancialReconciliationIncident", required: true, index: true },
  actor: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  fromStatus: { type: String, required: true, enum: ["pending", "investigating", "resolved"] },
  toStatus: { type: String, required: true, enum: ["investigating", "resolved"] },
  note: { type: String, required: true, maxlength: 2000 },
}, { timestamps: true });
schema.index({ incident: 1, createdAt: -1 });
export default mongoose.model("FinancialIncidentAudit", schema);
