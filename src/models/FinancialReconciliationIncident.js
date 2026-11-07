import mongoose from "mongoose";

const financialReconciliationIncidentSchema = new mongoose.Schema({
  order: { type: mongoose.Schema.Types.ObjectId, ref: "Order", required: true, index: true },
  provider: { type: String, required: true, default: "mercadopago" },
  providerOrderId: { type: String, required: true },
  reason: { type: String, required: true, enum: ["late_approval_after_closure", "approved_amount_mismatch"] },
  status: { type: String, enum: ["pending", "investigating", "resolved"], default: "pending", index: true },
  firstSeenAt: { type: Date, default: Date.now },
  lastSeenAt: { type: Date, default: Date.now },
  occurrences: { type: Number, default: 1, min: 1 },
}, { timestamps: true });
financialReconciliationIncidentSchema.index(
  { order: 1, provider: 1, providerOrderId: 1, reason: 1 },
  { unique: true }
);
export default mongoose.model("FinancialReconciliationIncident", financialReconciliationIncidentSchema);
