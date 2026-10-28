import { Router } from "express";

import auth from "../middlewares/auth.js";

import {
  createPixPayment,
  createCardPayment,
  getOrderPayment,
} from "../controllers/paymentController.js";

import {
  mercadoPagoOrderWebhook,
} from "../controllers/webhooks/MercadoPagoWebhookController.js";

const router = Router();

router.post(
  "/webhook",
  mercadoPagoOrderWebhook
);

router.get(
  "/order/:orderId",
  auth,
  getOrderPayment
);

router.post(
  "/order/:orderId/pix",
  auth,
  createPixPayment
);

router.post(
  "/order/:orderId/card",
  auth,
  createCardPayment
);

export default router;