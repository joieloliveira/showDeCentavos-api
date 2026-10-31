import mongoose from "mongoose";

// Registro de risco financeiro, independente do ledger. Não altera saldo.
const walletPaymentIncidentSchema = new mongoose.Schema({
  deposit: { type: mongoose.Schema.Types.ObjectId, ref: "WalletDeposit", required: true, index: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  provider: { type: String, enum: ["mercadopago"], required: true },
  providerOrderId: { type: String, required: true },
  providerStatus: { type: String, enum: ["refunded", "charged_back"], required: true },
  resolution: { type: String, enum: ["review_required", "resolved"], default: "review_required", required: true },
  lastObservedAt: { type: Date, required: true, default: Date.now },
}, { timestamps: true });
walletPaymentIncidentSchema.index({ deposit: 1, providerStatus: 1 }, { unique: true });
export default mongoose.model("WalletPaymentIncident", walletPaymentIncidentSchema);
