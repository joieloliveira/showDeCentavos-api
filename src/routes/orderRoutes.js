import { Router } from "express";

import auth from "../middlewares/auth.js";
import isSeller from "../middlewares/isSeller.js";
import isAdmin from "../middlewares/isAdmin.js";

import {
  createOrder,
  listMyOrders,
  getOrderById,
  listSellerOrders,
  updateSellerOrderStatus,
  listAdminOrders,
  updateAdminOrderStatus,
} from "../controllers/orderController.js";

const router = Router();

router.get(
  "/my",
  auth,
  listMyOrders
);

router.get(
  "/seller",
  auth,
  isSeller,
  listSellerOrders
);

router.get(
  "/admin",
  auth,
  isAdmin,
  listAdminOrders
);

router.put(
  "/admin/:id/status",
  auth,
  isAdmin,
  updateAdminOrderStatus
);

router.get(
  "/:id",
  auth,
  getOrderById
);

router.post(
  "/",
  auth,
  createOrder
);

router.put(
  "/seller/:id/status",
  auth,
  isSeller,
  updateSellerOrderStatus
);

export default router;