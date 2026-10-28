
import mongoose from "mongoose";

const bidSchema = new mongoose.Schema(
    {
        auction: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Auction",
            required: true,
            index: true,
        },

        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
            index: true,
        },

        idempotencyKey: {
            type: String,
            required: true,
            trim: true,
        },

        bidCostCents: {
            type: Number,
            required: true,
            min: 1,
        },

        priceBeforeCents: {
            type: Number,
            required: true,
            min: 0,
        },

        priceAfterCents: {
            type: Number,
            required: true,
            min: 0,
        },

        balanceAfterCents: {
            type: Number,
            required: true,
            min: 0,
        },

        expiresAt: {
            type: Date,
            required: true,
        },
    },
    {
        timestamps: true,
    }
);

bidSchema.index({ auction: 1, createdAt: -1 });
bidSchema.index({ user: 1, createdAt: -1 });

bidSchema.index(
    { user: 1, idempotencyKey: 1 },
    { unique: true }
);

const Bid = mongoose.models.Bid || mongoose.model("Bid", bidSchema);

export default Bid;
