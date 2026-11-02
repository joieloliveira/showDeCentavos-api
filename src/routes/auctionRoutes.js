
import { Router } from "express";

import auth from "../middlewares/auth.js";
import Bid from "../models/Bid.js";
import Auction from "../models/Auction.js";
import AuctionFulfillment from "../models/AuctionFulfillment.js";
import isAdmin from "../middlewares/isAdmin.js";

import {
  getBidByIdempotencyKey,
  placeBid,
} from "../controllers/bidController.js";


import {
  createAuction,
  listAuctions,
  listPublicWinners,
  getAuctionById,
  getAuctionLiveState,
  streamAuctionEvents,
  startAuctionWaiting,
} from "../controllers/auctionController.js";

const router = Router();

// Histórico de participações do usuário autenticado (somente leitura).
router.get("/my/participations", auth, async (req, res) => {
  try {
    const page = Math.min(10000, Math.max(1, Number.parseInt(req.query.page, 10) || 1));
    const limit = 20;
    const userId = req.user.id;
    const [groups, totalGroups, wonAuctions] = await Promise.all([
      Bid.aggregate([
        { $match: { user: new (await import("mongoose")).default.Types.ObjectId(userId) } },
        { $group: { _id: "$auction", bidCount: { $sum: 1 }, totalSpentCents: { $sum: "$bidCostCents" }, lastBidAt: { $max: "$createdAt" } } },
        { $sort: { lastBidAt: -1, _id: -1 } },
        { $skip: (page - 1) * limit }, { $limit: limit }
      ]),
      Bid.distinct("auction", { user: userId }),
      Auction.find({ winner: userId }).select("_id").lean()
    ]);
    const auctionIds = [...new Set([...groups.map(g => String(g._id)), ...wonAuctions.map(a => String(a._id))])];
    const auctions = await Auction.find({ _id: { $in: auctionIds } })
      .select("product status currentPriceCents winner endsAt startsAt")
      .populate("product", "name title images").lean();
    const byId = new Map(auctions.map(a => [String(a._id), a]));
    return res.json({
      page, limit, total: totalGroups.length,
      items: groups.map(g => {
        const auction = byId.get(String(g._id));
        return {
          auctionId: String(g._id),
          bidCount: g.bidCount,
          totalSpentCents: g.totalSpentCents,
          lastBidAt: g.lastBidAt,
          status: auction?.status ?? "unavailable",
          currentPriceCents: auction?.currentPriceCents ?? null,
          endsAt: auction?.endsAt ?? null,
          productName: auction?.product?.name ?? auction?.product?.title ?? "Produto",
          won: auction?.status === "finished" && String(auction?.winner ?? "") === String(userId)
        };
      })
    });
  } catch (error) {
    console.error("Erro ao consultar participações:", error);
    return res.status(500).json({ message: "Não foi possível consultar suas participações." });
  }
});

// Vitórias confirmadas do usuário, sem inferir pagamento ou entrega.
router.get("/my/wins", auth, async (req, res) => {
  try {
    const page = Math.max(1, Math.min(10000, Number.parseInt(req.query.page, 10) || 1));
    const limit = 20;
    const filter = { winner: req.user.id, status: "finished" };
    const [total, auctions] = await Promise.all([
      Auction.countDocuments(filter),
      Auction.find(filter)
        .select("product currentPriceCents endsAt bidCount")
        .populate("product", "name coverImage images")
        .sort({ endsAt: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean()
    ]);
    const fulfillmentRecords = await AuctionFulfillment.find({
      auction: { $in: auctions.map(auction => auction._id) },
      winner: req.user.id
    }).select("auction paymentStatus deliveryStatus").lean();
    const fulfillmentByAuction = new Map(fulfillmentRecords.map(record => [String(record.auction), record]));
    res.set("Cache-Control", "no-store");
    return res.json({
      page, limit, total,
      items: auctions.map(auction => ({
        auctionId: String(auction._id),
        productName: auction.product?.name || "Produto indisponível",
        coverImageUrl: auction.product?.coverImage?.url || auction.product?.images?.[0]?.url || null,
        finalPriceCents: auction.currentPriceCents,
        finishedAt: auction.endsAt,
        bidCount: auction.bidCount,
        paymentStatus: fulfillmentByAuction.get(String(auction._id))?.paymentStatus || "not_started",
        deliveryStatus: fulfillmentByAuction.get(String(auction._id))?.deliveryStatus || "not_started",
        fulfillmentAvailable: false
      }))
    });
  } catch (error) {
    console.error("Erro ao consultar vitórias:", error);
    return res.status(500).json({ message: "Não foi possível consultar suas vitórias." });
  }
});

// Listagem pública de leilões
router.get("/", listAuctions);
router.get("/winners", listPublicWinners);

router.get(
  "/bids/by-key/:idempotencyKey",
  auth,
  getBidByIdempotencyKey
);

router.post("/:id/bids", auth, placeBid);


// Consultar um leilão pelo ID
router.get("/:id/events", streamAuctionEvents);
router.get("/:id/live", getAuctionLiveState);
router.get("/:id", getAuctionById);

// Cadastro de leilões — somente administrador
router.post("/", auth, isAdmin, createAuction);

// Iniciar contagem de espera — somente administrador
router.post("/:id/start-waiting", auth, isAdmin, startAuctionWaiting);

export default router;
