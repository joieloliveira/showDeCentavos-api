
import { Router } from "express";

import auth from "../middlewares/auth.js";
import Bid from "../models/Bid.js";
import Auction from "../models/Auction.js";
import AuctionFulfillment from "../models/AuctionFulfillment.js";
import AuctionDeliveryAuditEvent from "../models/AuctionDeliveryAuditEvent.js";
import { validateAuctionShippingAddress } from "../services/auctionShippingAddress.js";
import { addressWriteDecision } from "../services/auctionAddressPolicy.js";
import { calculatePaymentDeadline, paymentWindowState, canPrepareDelivery, canMarkDelivered } from "../services/auctionFulfillmentRules.js";
import isAdmin from "../middlewares/isAdmin.js";
import { validPaymentStates, validDeliveryStates } from "../services/auctionFulfillmentFilters.js";

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
    // Count groups in MongoDB instead of materializing every distinct auction ID.
    // The facet keeps the page and total consistent within one aggregation.
    const mongoose = (await import("mongoose")).default;
    const [history = { items: [], metadata: [] }] = await Bid.aggregate([
      { $match: { user: new mongoose.Types.ObjectId(userId) } },
      { $group: { _id: "$auction", bidCount: { $sum: 1 }, totalSpentCents: { $sum: "$bidCostCents" }, lastBidAt: { $max: "$createdAt" } } },
      { $facet: {
        items: [
          { $sort: { lastBidAt: -1, _id: -1 } },
          { $skip: (page - 1) * limit },
          { $limit: limit }
        ],
        metadata: [{ $count: "total" }]
      } }
    ]);
    const groups = history.items;
    const total = history.metadata[0]?.total ?? 0;
    const auctionIds = groups.map(group => group._id);
    const auctions = await Auction.find({ _id: { $in: auctionIds } })
      .select("product status currentPriceCents winner endsAt startsAt")
      .populate("product", "name title images").lean();
    const byId = new Map(auctions.map(a => [String(a._id), a]));
    res.set("Cache-Control", "no-store");
    return res.json({
      page, limit, total,
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
    }).select("auction paymentStatus deliveryStatus shippingAddress addressSubmittedAt").lean();
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
        paymentDeadline: auction.endsAt ? calculatePaymentDeadline(auction.endsAt) : null,
        paymentWindowStatus: auction.endsAt ? paymentWindowState({
          wonAt: auction.endsAt,
          paymentStatus: fulfillmentByAuction.get(String(auction._id))?.paymentStatus || "not_started"
        }) : null,
        bidCount: auction.bidCount,
        paymentStatus: fulfillmentByAuction.get(String(auction._id))?.paymentStatus || "not_started",
        deliveryStatus: fulfillmentByAuction.get(String(auction._id))?.deliveryStatus || "not_started",
        shippingAddress: fulfillmentByAuction.get(String(auction._id))?.shippingAddress ?? null,
        addressSubmittedAt: fulfillmentByAuction.get(String(auction._id))?.addressSubmittedAt ?? null,
        addressEditable: (fulfillmentByAuction.get(String(auction._id))?.deliveryStatus ?? "not_started") === "not_started",
        fulfillmentAvailable: false
      }))
    });
  } catch (error) {
    console.error("Erro ao consultar vitórias:", error);
    return res.status(500).json({ message: "Não foi possível consultar suas vitórias." });
  }
});

// Save an address only for an authenticated winner; never change payment or shipping states.
router.put("/my/wins/:auctionId/address", auth, async (req, res) => {
  if (process.env.AUCTION_ADDRESS_COLLECTION_ENABLED !== "true") {
    return res.status(503).json({ message: "Cadastro de endereço de arremate ainda não habilitado." });
  }
  try {
    const mongoose = (await import("mongoose")).default;
    if (!mongoose.isValidObjectId(req.params.auctionId)) {
      return res.status(400).json({ message: "Identificador de leilão inválido." });
    }
    let address;
    try {
      address = validateAuctionShippingAddress(req.body);
    } catch (error) {
      return res.status(400).json({ message: error.message });
    }
    const auction = await Auction.findById(req.params.auctionId)
      .select("_id product winner currentPriceCents endsAt status").lean();
    const existing = auction ? await AuctionFulfillment.findOne({ auction: auction._id })
      .select("winner deliveryStatus").lean() : null;
    const decision = addressWriteDecision({
      featureEnabled: true, authenticatedUserId: req.user.id, auction, fulfillment: existing
    });
    if (decision.status !== 200) return res.status(decision.status).json({ message: decision.message });
    if (!auction.product || !auction.endsAt) {
      return res.status(409).json({ message: "Dados do arremate incompletos." });
    }
    const record = await AuctionFulfillment.findOneAndUpdate(
      { auction: auction._id, winner: req.user.id, deliveryStatus: "not_started" },
      {
        $set: { shippingAddress: address, addressSubmittedAt: new Date() },
        $setOnInsert: {
          auction: auction._id, winner: auction.winner, product: auction.product,
          winningPriceCents: auction.currentPriceCents, wonAt: auction.endsAt
        }
      },
      { upsert: !existing, returnDocument: "after", runValidators: true, setDefaultsOnInsert: true }
    );
    if (!record) return res.status(409).json({ message: "Não foi possível atualizar este endereço." });
    res.set("Cache-Control", "no-store");
    return res.json({ message: "Endereço salvo.", shippingAddress: record.shippingAddress });
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ message: "Arremate atualizado simultaneamente. Tente novamente." });
    console.error("Erro ao salvar endereço do arremate:", error);
    return res.status(500).json({ message: "Não foi possível salvar o endereço." });
  }
});

router.get("/admin/fulfillments", auth, isAdmin, async (req, res) => {
  try {
    const page = Math.max(1, Math.min(10000, Number.parseInt(req.query.page, 10) || 1));
    const limit = 20;
    const filter = {};
    if (req.query.paymentStatus !== undefined) {
      if (typeof req.query.paymentStatus !== "string" || !validPaymentStates.includes(req.query.paymentStatus)) {
        return res.status(400).json({ message: "Filtro de pagamento inválido." });
      }
      filter.paymentStatus = req.query.paymentStatus;
    }
    if (req.query.deliveryStatus !== undefined) {
      if (typeof req.query.deliveryStatus !== "string" || !validDeliveryStates.includes(req.query.deliveryStatus)) {
        return res.status(400).json({ message: "Filtro de entrega inválido." });
      }
      filter.deliveryStatus = req.query.deliveryStatus;
    }
    const [total, records] = await Promise.all([
      AuctionFulfillment.countDocuments(filter),
      AuctionFulfillment.find(filter)
        .select("auction winner product winningPriceCents wonAt paymentStatus deliveryStatus shippingAddress addressSubmittedAt")
        .sort({ wonAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean()
    ]);
    res.set("Cache-Control", "no-store");
    return res.json({ page, limit, total, items: records.map(record => ({
      auctionId: String(record.auction),
      winnerId: String(record.winner),
      productId: String(record.product),
      winningPriceCents: record.winningPriceCents,
      wonAt: record.wonAt,
      paymentDeadline: calculatePaymentDeadline(record.wonAt),
      paymentWindowStatus: paymentWindowState({ wonAt: record.wonAt, paymentStatus: record.paymentStatus }),
      paymentStatus: record.paymentStatus,
      deliveryStatus: record.deliveryStatus,
      shippingAddress: record.shippingAddress ?? null,
      addressSubmittedAt: record.addressSubmittedAt ?? null
    })) });
  } catch (error) {
    console.error("Erro ao listar entregas administrativas:", error);
    return res.status(500).json({ message: "Não foi possível consultar as entregas." });
  }
});

// Administrative delivery transitions. Payment status is never changed by this route.
router.patch("/admin/fulfillments/:auctionId/delivery", auth, isAdmin, async (req, res) => {
  if (process.env.AUCTION_DELIVERY_MANAGEMENT_ENABLED !== "true") {
    return res.status(503).json({ message: "Gestão de entregas ainda não habilitada." });
  }
  const mongoose = (await import("mongoose")).default;
  if (!mongoose.isValidObjectId(req.params.auctionId)) {
    return res.status(400).json({ message: "Identificador de leilão inválido." });
  }
  const target = req.body?.deliveryStatus;
  const previous = { preparing: "not_started", shipped: "preparing", delivered: "shipped" }[target];
  if (!previous) return res.status(400).json({ message: "Transição de entrega inválida." });
  try {
    const record = await AuctionFulfillment.findOne({
      auction: req.params.auctionId
    }).select("paymentStatus deliveryStatus addressSubmittedAt shippingAddress").lean();
    if (!record) return res.status(404).json({ message: "Arremate não encontrado." });
    if (record.paymentStatus !== "paid") {
      return res.status(409).json({ message: "Pagamento confirmado é obrigatório para entrega." });
    }
    if (!record.addressSubmittedAt) {
      return res.status(409).json({ message: "Endereço do vencedor ainda não informado." });
    }
    try {
      validateAuctionShippingAddress(record.shippingAddress);
    } catch {
      return res.status(409).json({ message: "Endereço do vencedor incompleto ou inválido." });
    }
    if (record.deliveryStatus !== previous ||
        (target === "preparing" && !canPrepareDelivery(record)) ||
        (target === "delivered" && !canMarkDelivered(record))) {
      return res.status(409).json({ message: "Estado atual não permite esta transição." });
    }
    const updated = await AuctionFulfillment.findOneAndUpdate(
      { auction: req.params.auctionId, paymentStatus: "paid",
        deliveryStatus: previous, addressSubmittedAt: { $ne: null } },
      { $set: { deliveryStatus: target } },
      { returnDocument: "after", runValidators: true }
    ).select("auction paymentStatus deliveryStatus");
    if (!updated) return res.status(409).json({ message: "Arremate alterado simultaneamente." });
    try {
      await AuctionDeliveryAuditEvent.create({
        auction: updated.auction, actor: req.user.id,
        fromStatus: previous, toStatus: target, occurredAt: new Date()
      });
    } catch (auditError) {
      // The delivery transition already committed. Surface the audit failure for operations.
      console.error("ALERTA: transição de entrega sem auditoria persistida:", String(updated.auction), target, auditError);
      return res.status(500).json({ message: "Entrega atualizada, mas o registro de auditoria falhou. Verifique o estado antes de tentar novamente." });
    }
    res.set("Cache-Control", "no-store");
    return res.json({ auctionId: String(updated.auction), paymentStatus: updated.paymentStatus,
      deliveryStatus: updated.deliveryStatus });
  } catch (error) {
    console.error("Erro ao atualizar entrega do arremate:", error);
    return res.status(500).json({ message: "Não foi possível atualizar a entrega." });
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
