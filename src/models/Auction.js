import mongoose from "mongoose";
import Product from "./Product.js";

const auctionSchema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: Product.modelName,
      required: true,
    },

    startPriceCents: {
      type: Number,
      default: 0,
      min: 0,
    },

    currentPriceCents: {
      type: Number,
      default: 0,
      min: 0,
    },

    bidCostCents: {
      type: Number,
      enum: [50, 100],
      required: true,
    },

    bidIncrementCents: {
      type: Number,
      default: 1,
      immutable: true,
    },

    bidCount: {
      type: Number,
      default: 0,
    },

    durationSeconds: {
      type: Number,
      default: 15,
      immutable: true,
      min: 15,
      max: 15,
    },

    waitingMinutes: {
      type: Number,
      default: 60,
      min: 1,
    },

    waitingStartedAt: {
      type: Date,
      default: null,
    },
    
    startsAt: {
      type: Date,
      default: null,
    },

    endsAt: {
      type: Date,
      default: null,
    },

    lastBidder: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    winner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    status: {
      type: String,
      enum: ["scheduled", "active", "finished", "cancelled"],
      default: "scheduled",
    },
  },
  {
    timestamps: true,
  }
);

auctionSchema.index({ status: 1, endsAt: 1 });

const Auction =
  mongoose.models.Auction ||
  mongoose.model("Auction", auctionSchema);

export default Auction;