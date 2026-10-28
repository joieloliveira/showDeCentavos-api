import WalletTransaction from "../models/WalletTransaction.js";
import User from "../models/User.js";

export const listWalletTransactions = async (req, res) => {
  try {
    const userId = req.user.id;

    const page = Math.max(
      1,
      Number.parseInt(req.query.page, 10) || 1
    );

    const limit = Math.min(
      50,
      Math.max(1, Number.parseInt(req.query.limit, 10) || 10)
    );

    const skip = (page - 1) * limit;

    const filter = { user: userId };

    const [transactions, total] = await Promise.all([
      WalletTransaction.find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),

      WalletTransaction.countDocuments(filter),
    ]);

    return res.status(200).json({
      transactions,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error(
      "Erro ao consultar histórico financeiro:",
      error
    );

    return res.status(500).json({
      message: "Erro ao consultar histórico financeiro.",
    });
  }
};

export const getWalletBalance = async (req, res) => {
  try {
    const user = await User.findById(req.user.id)
      .select("wallet.balanceCents")
      .lean();

    if (!user) {
      return res.status(404).json({
        message: "Usuário não encontrado.",
      });
    }

    return res.status(200).json({
      balanceCents: user.wallet?.balanceCents ?? 0,
    });
  } catch (error) {
    console.error(
      "Erro ao consultar saldo da carteira:",
      error
    );

    return res.status(500).json({
      message: "Erro ao consultar saldo da carteira.",
    });
  }
};
