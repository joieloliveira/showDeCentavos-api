import Auction from "../models/Auction.js";
import Product from "../models/Product.js";

const allowedStatuses = new Set(["scheduled", "active", "finished", "cancelled"]);

export const listAdminAuctions = async (req, res) => {
  try {
    const page = Number(req.query.page ?? 1);
    const limit = Number(req.query.limit ?? 20);
    const { status } = req.query;
    if (!Number.isSafeInteger(page) || page < 1 ||
        !Number.isSafeInteger(limit) || limit < 1 || limit > 100 ||
        (page - 1) * limit > Number.MAX_SAFE_INTEGER) {
      return res.status(400).json({ message: "Paginação inválida." });
    }
    if (status !== undefined && (typeof status !== "string" || !allowedStatuses.has(status))) {
      return res.status(400).json({ message: "Situação do leilão inválida." });
    }
    const filter = status ? { status } : {};
    const [total, auctions] = await Promise.all([
      Auction.countDocuments(filter),
      Auction.find(filter)
        .select("product startPriceCents currentPriceCents bidCostCents bidIncrementCents bidCount durationSeconds waitingMinutes waitingStartedAt startsAt endsAt status createdAt updatedAt")
        .populate({ path: "product", model: Product, select: "name slug price coverImage status" })
        .sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
    ]);
    return res.status(200).json({
      auctions,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (error) {
    console.error("Erro ao listar leilões administrativos:", error);
    return res.status(500).json({ message: "Erro ao consultar leilões." });
  }
};

export const listAdminAuctionProducts = async (req, res) => {
  try {
    const products = await Product.find({ status: "active" })
      .select("name slug price stock reservedStock")
      .sort({ name: 1, _id: 1 })
      .limit(100)
      .lean();
    return res.status(200).json({ products });
  } catch (error) {
    console.error("Erro ao consultar produtos para leilões:", error);
    return res.status(500).json({ message: "Erro ao consultar produtos." });
  }
};
