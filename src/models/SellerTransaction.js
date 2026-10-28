import mongoose from "mongoose";

const sellerTransactionSchema = new mongoose.Schema(
  {
    seller: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    order: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      required: true,
      index: true,
    },

    type: {
      type: String,
      enum: [
        "sale",
        "release",
        "withdrawal",
        "refund",
        "adjustment",
      ],
      required: true,
    },

    status: {
      type: String,
      enum: [
        "pending",
        "available",
        "paid",
        "cancelled",
      ],
      default: "pending",
      index: true,
    },

    grossAmount: {
      type: Number,
      required: true,
      min: 0,
    },

    platformFee: {
      type: Number,
      required: true,
      min: 0,
    },

    sellerAmount: {
      type: Number,
      required: true,
      min: 0,
    },

    availableAt: {
      type: Date,
      default: null,
    },

    paidAt: {
      type: Date,
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

sellerTransactionSchema.index({
  seller: 1,
  createdAt: -1,
});

const SellerTransaction = mongoose.model(
  "SellerTransaction",
  sellerTransactionSchema
);

export default SellerTransaction;