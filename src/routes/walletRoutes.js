
import { Router } from "express";

import auth from "../middlewares/auth.js";

import {
  listWalletTransactions,
  getWalletBalance,
} from "../controllers/walletController.js";

const router = Router();

// Consultar histórico financeiro do usuário autenticado
router.get("/transactions", auth, listWalletTransactions);
// Consultar saldo atual do usuário autenticado
router.get("/balance", auth, getWalletBalance);

export default router;
