import User from "../models/User.js";

const isAdmin = async (req, res, next) => {
  if (!req.user?.id) {
    return res.status(401).json({
      message: "Usuário não autenticado.",
    });
  }

  try {
    const user = await User.findById(req.user.id)
      .select("role isActive")
      .lean();

    if (!user || !user.isActive || user.role !== "admin") {
      return res.status(403).json({
        message: "Acesso permitido apenas para administradores ativos.",
      });
    }

    next();
  } catch (error) {
    console.error("Erro ao verificar permissão administrativa:", error);
    return res.status(500).json({
      message: "Erro interno ao verificar autorização.",
    });
  }
};

export default isAdmin;
