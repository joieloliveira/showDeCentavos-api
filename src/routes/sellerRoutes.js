import { Router } from "express";

import auth from "../middlewares/auth.js";
import isSeller from "../middlewares/isSeller.js";
import upload from "../middlewares/upload.js";

import {
  getSellerBySlug,
  updateSellerProfile,
  uploadSellerBanner
} from "../controllers/sellerController.js";

const router = Router();

router.put(
  "/profile",
  auth,
  isSeller,
  updateSellerProfile
);

router.get(
  "/:slug",
  getSellerBySlug
);

router.post(
  "/banner",
  auth,
  isSeller,
  upload.single("banner"),
  uploadSellerBanner
);

export default router;