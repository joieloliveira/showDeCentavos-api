// src/config/marketplace.js
export const BUSINESS_MODE =
  process.env.BUSINESS_MODE || "single_seller";

export const PAYMENT_PROVIDER =
  process.env.PAYMENT_PROVIDER || "mercadopago";

export const MIN_SELLER_PRODUCTS = 10;

export const MARKETPLACE_COMMISSION_PERCENT =
  BUSINESS_MODE === "marketplace"
    ? 10
    : 0;