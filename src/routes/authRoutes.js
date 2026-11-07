import { Router } from "express";

import auth from "../middlewares/auth.js";
import { createAuthRateLimiter } from "../middlewares/authRateLimiter.js";
import User from "../models/User.js";
import bcrypt from "bcryptjs";

import {
  register,
  login,
  forgotPassword,
  resetPassword,
  googleLogin,
} from "../controllers/authController.js";

const router = Router();

const loginLimit = createAuthRateLimiter({ maxAttempts: 10, windowMs: 15 * 60 * 1000 });
const recoveryLimit = createAuthRateLimiter({ maxAttempts: 5, windowMs: 15 * 60 * 1000 });

router.post("/register", register);
router.post("/login", loginLimit, login);
router.post("/google", loginLimit, googleLogin);
router.post("/forgot-password", recoveryLimit, forgotPassword);
router.post("/reset-password", recoveryLimit, resetPassword);

router.patch("/me/name", auth, async (req, res) => {
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  if (name.length < 2 || name.length > 100) return res.status(400).json({ message: "O nome deve ter entre 2 e 100 caracteres." });
  try {
    const user = await User.findOneAndUpdate({ _id: req.user.id, isActive: true }, { $set: { name } }, { new: true, runValidators: true });
    if (!user) return res.status(404).json({ message: "Conta não encontrada." });
    return res.json({ message: "Nome atualizado.", name: user.name });
  } catch (error) {
    console.error("Erro ao atualizar nome:", error);
    return res.status(500).json({ message: "Não foi possível atualizar o nome." });
  }
});

router.post("/me/change-password", auth, async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (typeof newPassword !== "string" || newPassword.length < 8 || newPassword.length > 128) {
    return res.status(400).json({ message: "A nova senha deve ter entre 8 e 128 caracteres." });
  }
  try {
    const user = await User.findOne({ _id: req.user.id, isActive: true }).select("+password");
    if (!user) return res.status(404).json({ message: "Conta não encontrada." });
    if (!user.password) return res.status(409).json({ message: "Use a recuperação por e-mail para definir uma senha nesta conta." });
    if (typeof currentPassword !== "string" || !(await bcrypt.compare(currentPassword, user.password))) {
      return res.status(401).json({ message: "Senha atual incorreta." });
    }
    user.password = await bcrypt.hash(newPassword, 10);
    user.passwordResetToken = null;
    user.passwordResetExpires = null;
    await user.save();
    return res.json({ message: "Senha alterada com sucesso." });
  } catch (error) {
    console.error("Erro ao alterar senha:", error);
    return res.status(500).json({ message: "Não foi possível alterar a senha." });
  }
});

router.get(
  "/me",
  auth,
  async (req, res) => {
    try {
      const user =
        await User.findById(
          req.user.id
        );

      if (!user || !user.isActive) {
        return res.status(403).json({ message: "Conta indisponível." });
      }

      return res.status(200).json({
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
          publicNickname: user.publicNickname,
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