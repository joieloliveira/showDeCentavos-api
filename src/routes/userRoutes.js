import { Router } from "express";

import auth from "../middlewares/auth.js";
import isAdmin from "../middlewares/isAdmin.js";
import {
  becomeSeller,
  listAdminUsers,
  getAdminUserById,
  updateAdminUserStatus,
  updateAdminUserRole,
} from "../controllers/userController.js";

const router = Router();

router.get("/me", auth, (req, res) => {
  return res.status(200).json({
    message: "Usuário autenticado.",
    user: req.user,
  });
});

router.get(
  "/admin",
  auth,
  isAdmin,
  listAdminUsers
);

router.get(
  "/admin/:id",
  auth,
  isAdmin,
  getAdminUserById
);

router.put(
  "/admin/:id/status",
  auth,
  isAdmin,
  updateAdminUserStatus
);

router.put(
  "/admin/:id/role",
  auth,
  isAdmin,
  updateAdminUserRole
);

router.post("/become-seller", auth, becomeSeller);

export default router;