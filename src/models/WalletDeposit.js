
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
