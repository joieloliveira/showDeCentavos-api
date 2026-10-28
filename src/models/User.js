import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 100,
    },

    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },

    password: {
      type: String,
      required: false,
      minlength: 6,
      select: false,
      default: null,
    },

    googleId: {
      type: String,
      default: null,
      select: false,
    },

    role: {
      type: String,
      enum: ["customer", "seller", "admin"],
      default: "customer",
    },

    avatar: {
      type: String,
      default: null,
    },

    phone: {
      type: String,
      default: null,
      trim: true,
    },

    cpf: {
      type: String,
      default: null,
      trim: true,
    },

    seller: {
      storeName: {
        type: String,
        default: null,
        trim: true,
        maxlength: 100,
      },

      storeSlug: {
        type: String,
        default: null,
        lowercase: true,
        trim: true,
      },

      description: {
        type: String,
        default: null,
        maxlength: 1000,
      },

      banner: {
        url: {
          type: String,
          default: null,
        },

        key: {
          type: String,
          default: null,
        },
      },

      isActive: {
        type: Boolean,
        default: false,
      },

      mercadoPago: {
        connected: {
          type: Boolean,
          default: false,
        },

        userId: {
          type: String,
          default: null,
        },

        accessToken: {
          type: String,
          default: null,
        },

        refreshToken: {
          type: String,
          default: null,
        },

        publicKey: {
          type: String,
          default: null,
        },

        tokenExpiresAt: {
          type: Date,
          default: null,
        },
      },
    },

    isActive: {
      type: Boolean,
      default: true,
    },

    wallet: {
      balanceCents: {
        type: Number,
        default: 0,
        min: 0,
      },
    },

    emailVerified: {
      type: Boolean,
      default: false,
    },

    lastLogin: {
      type: Date,
      default: null,
    },

    passwordResetToken: {
      type: String,
      default: null,
      select: false,
    },

    passwordResetExpires: {
      type: Date,
      default: null,
      select: false,
    },
  },
  {
    timestamps: true,
  }
);

userSchema.index(
  { googleId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      googleId: { $type: "string" },
    },
  }
);

userSchema.index(
  { "seller.storeSlug": 1 },
  {
    unique: true,
    partialFilterExpression: {
      "seller.storeSlug": { $type: "string" },
    },
  }
);


const User = mongoose.model("User", userSchema);

export default User;