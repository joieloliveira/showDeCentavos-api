
import mongoose from "mongoose";

const walletTransactionSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    type: {
      type: String,
      enum: [
        "deposit",
        "bid",
        "refund",
        "adjustment",
      ],
      required: true,
    },

    amountCents: {
      type: Number,
      required: true,
      validate: {
        validator: Number.isSafeInteger,
        message: "O valor deve ser um número inteiro.",
      },
    },

    balanceAfterCents: {
      type: Number,
      required: true,
      min: 0,
    },

    auction: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Auction",
      default: null,
    },

    bid: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Bid",
      default: null,
    },

    deposit: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "WalletDeposit",
      default: null,
    },

    description: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

walletTransactionSchema.index({
  user: 1,
  createdAt: -1,
});

walletTransactionSchema.index(
  { bid: 1 },
  {
    unique: true,
    partialFilterExpression: {
      bid: { $type: "objectId" },
    },
  }
);

// Cada depósito pode gerar somente
// uma movimentação financeira de crédito.
walletTransactionSchema.index(
  { deposit: 1 },
  {
    unique: true,
    partialFilterExpression: {
      deposit: { $type: "objectId" },
    },
  }
);

const WalletTransaction = mongoose.model(
  "WalletTransaction",
  walletTransactionSchema
);

export default WalletTransaction;
