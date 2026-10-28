import { Router } from "express";

import auth from "../middlewares/auth.js";
import isSeller from "../middlewares/isSeller.js";

import {
  connectMercadoPago,
} from "../controllers/mercadoPagoOAuthController.js";

const router = Router();

router.get(
  "/connect",
  auth,
  isSeller,
  connectMercadoPago
);

export default router;