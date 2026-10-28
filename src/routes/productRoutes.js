import { Router } from "express";

import auth from "../middlewares/auth.js";
import isSeller from "../middlewares/isSeller.js";
import upload from "../middlewares/upload.js";

import {
  createProduct,
  listProducts,
  listMyProducts,
  getProductBySlug,
  updateProduct,
  deleteProduct,
  uploadProductImages,
  deleteProductImage,
  setProductCover,
  getProductById,
} from "../controllers/productController.js";

const router = Router();

router.get("/", listProducts);

router.get(
  "/my",
  auth,
  isSeller,
  listMyProducts
);

router.get(
  "/id/:id",
  auth,
  isSeller,
  getProductById
);

router.get("/:slug", getProductBySlug);

router.post(
  "/",
  auth,
  isSeller,
  createProduct
);

router.post(
  "/:id/images",
  auth,
  isSeller,
  upload.array("images", 8),
  uploadProductImages
);

router.delete(
  "/:id/images",
  auth,
  isSeller,
  deleteProductImage
);

router.put(
  "/:id",
  auth,
  isSeller,
  updateProduct
);

router.delete(
  "/:id",
  auth,
  isSeller,
  deleteProduct
);

router.put(
  "/:id/cover",
  auth,
  isSeller,
  setProductCover
);

export default router;