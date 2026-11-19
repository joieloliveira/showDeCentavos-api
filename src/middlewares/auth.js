import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import User from "../models/User.js";

const auth = async (req, res, next) => {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ message: "Token não informado." });
  const parts = header.split(" ");
  if (parts.length !== 2 || parts[0] !== "Bearer" || !parts[1]) {
    return res.status(401).json({ message: "Formato de token inválido." });
  }

  let decoded;
  try {
    decoded = jwt.verify(parts[1], process.env.JWT_SECRET, { algorithms: ["HS256"] });
  } catch {
    return res.status(401).json({ message: "Token inválido ou expirado." });
  }
  if (!decoded || typeof decoded !== "object" ||
      typeof decoded.id !== "string" || !mongoose.isValidObjectId(decoded.id)) {
    return res.status(401).json({ message: "Token inválido ou expirado." });
  }

  try {
    const user = await User.findById(decoded.id).select("role isActive").lean();
    if (!user || !user.isActive) {
      return res.status(403).json({ message: "Conta indisponível." });
    }
    req.user = { id: String(user._id), role: user.role };
    return next();
  } catch (error) {
    console.error("Erro ao verificar conta autenticada:", error);
    return res.status(503).json({ message: "Não foi possível validar a sessão." });
  }
};

export default auth;
