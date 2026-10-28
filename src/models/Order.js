import mongoose from "mongoose";

const orderItemSchema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },

    seller: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    name: {
      type: String,
      required: true,
    },

    image: {
      type: String,
      default: null,
    },

    quantity: {
      type: Number,
      required: true,
      min: 1,
    },

    unitPrice: {
      type: Number,
      required: true,
      min: 0,
    },

    total: {
      type: Number,
      required: true,
      min: 0,
    },

    platformFeePercent: {
      type: Number,
      required: true,
      min: 0,
    },

    platformFeeAmount: {
      type: Number,
      required: true,
      min: 0,
    },

    sellerAmount: {
      type: Number,
      required: true,
      min: 0,
    },

    status: {
      type: String,
      enum: [
        "pending",
        "processing",
        "shipped",
        "delivered",
        "cancelled",
      ],
      default: "pending",
    },
  },
  {
    _id: false,
  }
);

const orderSchema = new mongoose.Schema(
  {
    platformFeeTotal: {
      type: Number,
      required: true,
      min: 0,
    },

    sellerTotal: {
      type: Number,
      required: true,
      min: 0,
    },

    buyer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    buyerSnapshot: {
      name: {
        type: String,
        required: true,
      },

      email: {
        type: String,
        required: true,
      },

      phone: {
        type: String,
        default: null,
      },
    },

    shippingAddress: {
      recipientName: {
        type: String,
        required: true,
      },

      phone: {
        type: String,
        required: true,
      },

      zipCode: {
        type: String,
        required: true,
      },

      street: {
        type: String,
        required: true,
      },

      number: {
        type: String,
        required: true,
      },

      complement: {
        type: String,
        default: null,
      },

      neighborhood: {
        type: String,
        required: true,
      },

      city: {
        type: String,
        required: true,
      },

      state: {
        type: String,
        required: true,
      },

      country: {
        type: String,
        default: "BR",
      },
    },

    items: {
      type: [orderItemSchema],
      required: true,
    },

    subtotal: {
      type: Number,
      required: true,
      min: 0,
    },

    shipping: {
      type: Number,
      default: 0,
      min: 0,
    },

    discount: {
      type: Number,
      default: 0,
      min: 0,
    },

    total: {
      type: Number,
      required: true,
      min: 0,
    },

    paymentStatus: {
      type: String,
      enum: [
        "pending",
        "paid",
        "failed",
        "refunded",
        "cancelled",
      ],
      default: "pending",
      index: true,
    },

    status: {
      type: String,
      enum: [
        "pending",
        "processing",
        "shipped",
        "delivered",
        "cancelled",
      ],
      default: "pending",
      index: true,
    },

    stockReservation: {
      reserved: {
        type: Boolean,
        default: false,
      },

      reservedAt: {
        type: Date,
        default: null,
      },

      expiresAt: {
        type: Date,
        default: null,
      },

      releasedAt: {
        type: Date,
        default: null,
      },
    },

    payment: {
      provider: {
        type: String,
        default: "mercadopago",
      },

      // Campos genéricos
      providerOrderId: {
        type: String,
        default: null,
      },

      providerPaymentId: {
        type: String,
        default: null,
      },

      processedProviderOrderId: {
        type: String,
        default: null,
      },

      // Campos antigos — manter por compatibilidade
      mercadoPagoOrderId: {
        type: String,
        default: null,
      },

      paymentId: {
        type: String,
        default: null,
      },

      idempotencyKey: {
        type: String,
        default: null,
      },

      attemptStatus: {
        type: String,
        enum: [
          "preparing",
          "submitted",
          "resolved",
        ],
        default: null,
      },

      attemptStartedAt: {
        type: Date,
        default: null,
      },

      processedAt: {
        type: Date,
        default: null,
      },

      processedMercadoPagoOrderId: {
        type: String,
        default: null,
      },

      lastWebhookNotificationId: {
        type: String,
        default: null,
      },

      paymentMethod: {
        type: String,
        default: null,
      },
    },
  },
  {
    timestamps: true,
  }
);

const Order = mongoose.model("Order", orderSchema);

export default Order;