import { Router } from "express";

import auth from "../middlewares/auth.js";

import {
  createReview,
  listProductReviews,
  updateReview,
  deleteReview,
} from "../controllers/reviewController.js";

const router = Router();

router.get(
  "/product/:productId",
  listProductReviews
);

router.post(
  "/product/:productId",
  auth,
  createReview
);

router.put(
  "/:id",
  auth,
  updateReview
);

router.delete(
  "/:id",
  auth,
  deleteReview
);

export default router;