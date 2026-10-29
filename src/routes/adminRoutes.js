import { Router } from "express";

import auth from "../middlewares/auth.js";
import isAdmin from "../middlewares/isAdmin.js";
import { listAdminWalletIncidents, getAdminWalletIncident } from "../controllers/adminWalletIncidentController.js";

import {
  reconcileStockReservations,
  getAdminDashboard,
  getAdminFinancial,
} from "../controllers/adminController.js";

const router = Router();

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