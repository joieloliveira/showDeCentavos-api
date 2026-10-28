import mongoose from "mongoose";
import mongoosePaginate from "mongoose-paginate-v2";

const productSchema = new mongoose.Schema(
  {
    seller: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    name: {
      type: String,
      required: true,
      trim: true,
      minlength: 3,
      maxlength: 150,
    },

    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },

    description: {
      type: String,
      required: true,
      trim: true,
      maxlength: 5000,
    },

    price: {
      type: Number,
      required: true,
      min: 0,
    },

    coverImage: {
      url: {
        type: String,
        default: null,
      },

      key: {
        type: String,
        default: null,
      },
    },

    images: [
      {
        url: {
          type: String,
          required: true,
        },

        key: {
          type: String,
          required: true,
        },
      },
    ],

    video: {
      type: String,
      default: null,
    },

    category: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Category",
      default: null,
      index: true,
    },

    tags: [
      {
        type: String,
        trim: true,
        lowercase: true,
      },
    ],

    stock: {
      type: Number,
      default: 0,
      min: 0,
    },

    reservedStock: {
      type: Number,
      default: 0,
      min: 0,
    },

    status: {
      type: String,
      enum: ["draft", "active", "inactive", "out_of_stock"],
      default: "draft",
      index: true,
    },

    printingInfo: {
      material: {
        type: String,
        default: null,
        trim: true,
      },

      layerHeight: {
        type: String,
        default: null,
        trim: true,
      },

      scale: {
        type: String,
        default: null,
        trim: true,
      },

      supports: {
        type: Boolean,
        default: false,
      },
    },

    views: {
      type: Number,
      default: 0,
      min: 0,
    },

    sales: {
      type: Number,
      default: 0,
      min: 0,
    },

    isFeatured: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

productSchema.plugin(mongoosePaginate);

const Product = mongoose.model("Product", productSchema);

export default Product;