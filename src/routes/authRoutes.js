import { Router } from "express";

import auth from "../middlewares/auth.js";
import User from "../models/User.js";

import {
  register,
  login,
  forgotPassword,
  resetPassword,
  googleLogin,
} from "../controllers/authController.js";

const router = Router();

router.post("/register", register);
router.post("/login", login);
router.post("/google", googleLogin);
router.post("/forgot-password", forgotPassword);
router.post("/reset-password", resetPassword);

router.get(
  "/me",
  auth,
  async (req, res) => {
    try {
      const user =
        await User.findById(
          req.user.id
        );

      if (!user) {
        return res.status(404).json({
          message:
            "Usuário não encontrado.",
        });
      }

      return res.status(200).json({
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
        },
      });
    } catch (error) {
      console.error(
        "Erro ao consultar usuário:",
        error
      );

      return res.status(500).json({
        message:
          "Erro interno do servidor.",
      });
    }
  }
);

export default router;