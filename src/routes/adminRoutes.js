import { Router } from "express";

import auth from "../middlewares/auth.js";
import upload from "../middlewares/upload.js";
import { uploadProductImages, deleteProductImage, setProductCover } from "../controllers/productController.js";
import { listAdminProducts, createAdminProduct, updateAdminProduct } from "../controllers/adminProductController.js";
import { listAdminAuctions, listAdminAuctionProducts } from "../controllers/adminAuctionController.js";
import isAdmin from "../middlewares/isAdmin.js";
import { listAdminWalletIncidents, getAdminWalletIncident } from "../controllers/adminWalletIncidentController.js";

import {
  reconcileStockReservations,
  getAdminDashboard,
  getAdminFinancial,
} from "../controllers/adminController.js";

const router = Router();

router.get("/products", auth, isAdmin, listAdminProducts);
router.post("/products", auth, isAdmin, createAdminProduct);
router.patch("/products/:id", auth, isAdmin, updateAdminProduct);
router.post("/products/:id/images", auth, isAdmin, upload.array("images", 8), uploadProductImages);
router.delete("/products/:id/images", auth, isAdmin, deleteProductImage);
router.put("/products/:id/cover", auth, isAdmin, setProductCover);
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