import { Router } from "express";

import auth from "../middlewares/auth.js";
import { listAdminAuctions, listAdminAuctionProducts } from "../controllers/adminAuctionController.js";
import isAdmin from "../middlewares/isAdmin.js";
import { listAdminWalletIncidents, getAdminWalletIncident } from "../controllers/adminWalletIncidentController.js";

import {
  reconcileStockReservations,
  getAdminDashboard,
  getAdminFinancial,
} from "../controllers/adminController.js";

const router = Router();

router.get("/auctions/products", auth, isAdmin, listAdminAuctionProducts);
router.get("/auctions", auth, isAdmin, listAdminAuctions);

router.get("/wallet/incidents", auth, isAdmin, listAdminWalletIncidents);
router.get("/wallet/incidents/:incidentId", auth, isAdmin, getAdminWalletIncident);

router.get(
  "/dashboard",
  auth,
  isAdmin,
  getAdminDashboard
);

router.get(
  "/financial",
  auth,
  isAdmin,
  getAdminFinancial
);

router.post(
  "/reconcile-stock",
  auth,
  isAdmin,
  reconcileStockReservations
);

export default router;