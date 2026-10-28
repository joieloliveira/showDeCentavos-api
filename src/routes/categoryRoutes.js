import { Router } from "express";

import auth from "../middlewares/auth.js";
import isAdmin from "../middlewares/isAdmin.js";

import {
  createCategory,
  listCategories,
  listAdminCategories,
  getCategoryById,
  updateCategory,
  deleteCategory,
} from "../controllers/categoryController.js";

const router = Router();

router.get("/", listCategories);

router.post(
  "/",
  auth,
  isAdmin,
  createCategory
);

router.get(
  "/admin",
  auth,
  isAdmin,
  listAdminCategories
);

router.get(
  "/admin/:id",
  auth,
  isAdmin,
  getCategoryById
);

router.put(
  "/admin/:id",
  auth,
  isAdmin,
  updateCategory
);

router.delete(
  "/admin/:id",
  auth,
  isAdmin,
  deleteCategory
);

export default router;