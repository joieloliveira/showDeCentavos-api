import mongoose from "mongoose";
import Auction from "../models/Auction.js";
import Bid from "../models/Bid.js";
import WalletTransaction from "../models/WalletTransaction.js";

// Read-only financial reconciliation view, restricted to active admins by the router.
export async function listAdminAuctionBids(req, res) {
  try {
    const { id } = req.params;
    const page = Number(req.query.page ?? 1);
    const limit = Number(req.query.limit ?? 20);
    if (!mongoose.isValidObjectId(id)) return res.status(400).json({ message: "ID inválido." });
    if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(limit) ||
        limit < 1 || limit > 100 || (page - 1) * limit > Number.MAX_SAFE_INTEGER) {
      return res.status(400).json({ message: "Paginação inválida." });
    }
    if (!(await Auction.exists({ _id: id }))) return res.status(404).json({ message: "Leilão não encontrado." });
    const [total, bids] = await Promise.all([
      Bid.countDocuments({ auction: id }),
      Bid.find({ auction: id })
        .select("user bidCostCents priceBeforeCents priceAfterCents balanceAfterCents expiresAt createdAt")
        .sort({ createdAt: 1, _id: 1 }).skip((page - 1) * limit).limit(limit).lean(),
    ]);
    const transactions = await WalletTransaction.find({
      auction: id, type: "bid", bid: { $in: bids.map(b => b._id) },
    }).select("bid user amountCents balanceAfterCents createdAt").lean();
    const ledgerByBid = new Map(transactions.map(t => [String(t.bid), t]));
    const entries = bids.map(b => {
      const t = ledgerByBid.get(String(b._id));
      const matched = Boolean(t) && String(t.user) === String(b.user) &&
        t.amountCents === -b.bidCostCents && t.balanceAfterCents === b.balanceAfterCents;
      return {
        bidId: b._id, userId: b.user, bidCostCents: b.bidCostCents,
        priceBeforeCents: b.priceBeforeCents, priceAfterCents: b.priceAfterCents,
        balanceAfterCents: b.balanceAfterCents, expiresAt: b.expiresAt,
        createdAt: b.createdAt, ledgerStatus: !t ? "missing" : matched ? "matched" : "mismatch",
        transactionId: t?._id ?? null,
      };
    });
    res.set("Cache-Control", "no-store");
    return res.json({ bids: entries, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
  } catch (error) {
    console.error("Erro ao consultar histórico financeiro de lances:", error);
    return res.status(500).json({ message: "Erro ao consultar lances." });
  }
}

export async function getAdminAuctionBidReconciliationSummary(req, res) {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) return res.status(400).json({ message: "ID inválido." });
    if (!(await Auction.exists({ _id: id }))) return res.status(404).json({ message: "Leilão não encontrado." });
    const [summary] = await Bid.aggregate([
      { $match: { auction: new mongoose.Types.ObjectId(id) } },
      { $lookup: {
        from: WalletTransaction.collection.name,
        let: { bidId: "$_id" },
        pipeline: [
          { $match: { $expr: { $eq: ["$bid", "$$bidId"] }, type: "bid" } },
          { $project: { user: 1, auction: 1, amountCents: 1, balanceAfterCents: 1 } },
        ],
        as: "ledger",
      } },
      { $project: {
        status: { $cond: [
          { $eq: [{ $size: "$ledger" }, 0] }, "missing",
          { $cond: [
            { $and: [
              { $eq: [{ $size: "$ledger" }, 1] },
              { $eq: [{ $arrayElemAt: ["$ledger.user", 0] }, "$user"] },
              { $eq: [{ $arrayElemAt: ["$ledger.auction", 0] }, "$auction"] },
              { $eq: [{ $arrayElemAt: ["$ledger.amountCents", 0] }, { $multiply: ["$bidCostCents", -1] }] },
              { $eq: [{ $arrayElemAt: ["$ledger.balanceAfterCents", 0] }, "$balanceAfterCents"] },
            ] }, "matched", "mismatch",
          ] },
        ] },
        bidCostCents: 1,
      } },
      { $group: {
        _id: null, total: { $sum: 1 },
        matched: { $sum: { $cond: [{ $eq: ["$status", "matched"] }, 1, 0] } },
        missing: { $sum: { $cond: [{ $eq: ["$status", "missing"] }, 1, 0] } },
        mismatch: { $sum: { $cond: [{ $eq: ["$status", "mismatch"] }, 1, 0] } },
      } },
    ]);
    res.set("Cache-Control", "no-store");
    return res.json({ summary: {
      total: summary?.total ?? 0, matched: summary?.matched ?? 0,
      missing: summary?.missing ?? 0, mismatch: summary?.mismatch ?? 0,
    } });
  } catch (error) {
    console.error("Erro no resumo de conciliação dos lances:", error);
    return res.status(500).json({ message: "Erro ao consultar conciliação." });
  }
}
