
import mongoose from "mongoose";

const walletDepositSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    amountCents: {
      type: Number,
      required: true,
      min: 1,
      validate: Number.isSafeInteger,
    },

    status: {
      type: String,
      enum: [
        "pending",
        "approved",
        "failed",
        "cancelled",
      ],
      default: "pending",
      required: true,
    },

    provider: {
      type: String,
      enum: ["manual_test", "mercadopago"],
      required: true,
    },

    providerOrderId: { type: String, default: null },
    idempotencyKey: { type: String, default: null },
    chargeStatus: { type: String, enum: ["submitted", "resolved"], default: null },
    pix: {
      qrCode: { type: String, default: null },
      qrCodeBase64: { type: String, default: null },
      ticketUrl: { type: String, default: null },
    },

    providerPaymentId: {
      type: String,
      default: null,
    },

    processedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

walletDepositSchema.index({ provider: 1, providerOrderId: 1 }, {
  unique: true,
  partialFilterExpression: { providerOrderId: { $type: "string" } },
});
walletDepositSchema.index({ provider: 1, idempotencyKey: 1 }, {
  unique: true,
  partialFilterExpression: { idempotencyKey: { $type: "string" } },
});

// Impede reutilizar o mesmo identificador
// de pagamento do provedor.
walletDepositSchema.index(
  {
    provider: 1,
    providerPaymentId: 1,
  },
  {
    unique: true,
    partialFilterExpression: {
      providerPaymentId: { $type: "string" },
    },
  }
);

const WalletDeposit = mongoose.model(
  "WalletDeposit",
  walletDepositSchema
);

export default WalletDeposit;
