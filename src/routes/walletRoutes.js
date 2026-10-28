
import { Router } from "express";

import auth from "../middlewares/auth.js";

import {
  listWalletTransactions,
  getWalletBalance,
} from "../controllers/walletController.js";

import { createWalletPixDeposit, getWalletDeposit, reconcileWalletPixDeposit } from "../controllers/walletDepositController.js";
import { walletPixWebhook } from "../controllers/webhooks/WalletPixWebhookController.js";

const router = Router();

router.post("/deposits/pix/webhook", walletPixWebhook);
router.post("/deposits/pix", auth, createWalletPixDeposit);
router.get("/deposits/:depositId", auth, getWalletDeposit);
router.post("/deposits/:depositId/reconcile", auth, reconcileWalletPixDeposit);

// Consultar histórico financeiro do usuário autenticado
router.get("/transactions", auth, listWalletTransactions);
// Consultar saldo atual do usuário autenticado
router.get("/balance", auth, getWalletBalance);

export default router;
