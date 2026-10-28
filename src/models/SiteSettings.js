import mongoose from "mongoose";

const responsiveImageSchema =
  new mongoose.Schema(
    {
      desktop: {
        type: String,
        default: null,
      },

      tablet: {
        type: String,
        default: null,
      },

      mobile: {
        type: String,
        default: null,
      },
    },
    {
      _id: false,
    }
  );

const siteSettingsSchema =
  new mongoose.Schema(
    {
      branding: {
        logo: {
          type: responsiveImageSchema,
          default: () => ({}),
        },
      },

      banners: {
        home: {
          type: responsiveImageSchema,
          default: () => ({}),
        },
      },

      content: {
        about: {
          type: String,
          default: "",
          trim: true,
        },

        rules: {
          type: String,
          default: "",
          trim: true,
        },
      },
    },
    {
      timestamps: true,
    }
  );

const SiteSettings =
  mongoose.models.SiteSettings ||
  mongoose.model(
    "SiteSettings",
    siteSettingsSchema
  );

export default SiteSettings;