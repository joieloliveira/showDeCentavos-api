import { subscribeAuctionEvents } from "../services/AuctionEventsService.js";

import mongoose from "mongoose";
import Auction from "../models/Auction.js";
import { recordAuctionAuditEvent } from "../services/AuctionAuditService.js";
import Product from "../models/Product.js";
import User from "../models/User.js";

async function getPublicWinnerNickname(auction) {
  if (auction?.status !== "finished" || !auction.winner) return null;
  const user = await User.findById(auction.winner).select("publicNickname").lean();
  return user?.publicNickname || null;
}


export const createAuction = async (req, res) => {
  try {
    if (req.user?.role !== "admin") {
      return res.status(403).json({
        message: "Apenas administradores podem criar leilões.",
      });
    }

    const {
      product,
      startPriceCents = 0,
      bidCostCents,
    } = req.body;

    if (!mongoose.isValidObjectId(product)) {
      return res.status(400).json({
        message: "Produto inválido.",
      });
    }

    const productExists = await Product.findById(product);

    if (!productExists) {
      return res.status(404).json({
        message: "Produto não encontrado.",
      });
    }

    const initialPrice = Number(startPriceCents);
    const bidCost = Number(bidCostCents);

    if (
      !Number.isSafeInteger(initialPrice) ||
      initialPrice < 0 ||
      ![50, 100].includes(bidCost)
    ) {
      return res.status(400).json({
        message: "Valores do leilão inválidos.",
      });
    }
    
    const auction = await Auction.create({
      product: productExists._id,
      startPriceCents: initialPrice,
      currentPriceCents: initialPrice,
      bidCostCents: bidCost,
      bidIncrementCents: 1,
      bidCount: 0,
      durationSeconds: 15,
      waitingStartedAt: null,
      startsAt: null,
      endsAt: null,
      status: "scheduled",
    });

    await recordAuctionAuditEvent(auction._id, "created", auction.createdAt, "admin", req.user?._id ?? req.user?.id ?? null);
    return res.status(201).json({
      message: "Leilão cadastrado com sucesso.",
      auction,
    });
  } catch (error) {
    console.error("Erro ao cadastrar leilão:", error);

    return res.status(500).json({
      message: "Erro interno do servidor.",
    });
  }
};


export const listAuctions = async (req, res) => {
  try {
    const auctions = await Auction.find()
      .populate({
        path: "product",
        model: Product,
        select: "name slug price images coverImage status",
      })
      .sort({ createdAt: -1 })
      .lean();

    const winnerIds = [...new Set(auctions.filter(a => a.status === 'finished' && a.winner).map(a => String(a.winner)))];
    const winnerUsers = winnerIds.length ? await User.find({ _id: { $in: winnerIds } })
      .select('publicNickname').lean() : [];
    const nicknames = new Map(winnerUsers.map(u => [String(u._id), u.publicNickname || null]));
    const publicAuctions = auctions.map(({ winner, lastBidder, ...auction }) => ({
      ...auction,
      winnerNickname: auction.status === 'finished' && winner ? (nicknames.get(String(winner)) || null) : null,
    }));
    res.set("Cache-Control", "no-store");
    return res.status(200).json({
      auctions: publicAuctions,
    });
  } catch (error) {
    console.error("Erro ao listar leilões:", error);

    return res.status(500).json({
      message: "Erro interno do servidor.",
    });
  }
};


export const getAuctionById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({
        message: "ID do leilão inválido.",
      });
    }

    const auction = await Auction.findById(id)
      .populate({
        path: "product",
        model: Product,
        select: "name slug description price images coverImage status",
      });

    if (!auction) {
      return res.status(404).json({
        message: "Leilão não encontrado.",
      });
    }

    const safeAuction = auction.toObject();
    delete safeAuction.winner;
    delete safeAuction.lastBidder;
    safeAuction.winnerNickname = await getPublicWinnerNickname(auction);
    return res.status(200).json({ auction: safeAuction });
  } catch (error) {
    console.error("Erro ao buscar leilão:", error);

    return res.status(500).json({
      message: "Erro interno do servidor.",
    });
  }
};


export const startAuctionWaiting = async (req, res) => {
  try {
    if (req.user?.role !== "admin") {
      return res.status(403).json({
        message: "Apenas administradores podem iniciar a espera.",
      });
    }

    const { id } = req.params;
    const { waitingMinutes } = req.body;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({
        message: "ID do leilão inválido.",
      });
    }

    const auction = await Auction.findById(id);

    if (!auction) {
      return res.status(404).json({
        message: "Leilão não encontrado.",
      });
    }

    if (auction.status !== "scheduled" || auction.waitingStartedAt) {
      return res.status(409).json({
        message: "Este leilão não pode iniciar uma nova espera.",
      });
    }

    const minutes =
      waitingMinutes === undefined
        ? auction.waitingMinutes
        : Number(waitingMinutes);

    if (!Number.isSafeInteger(minutes) || minutes < 1) {
      return res.status(400).json({
        message: "O tempo de espera deve ser um número inteiro positivo.",
      });
    }

    const now = new Date();
    const startsAt = new Date(now.getTime() + minutes * 60 * 1000);

    const updatedAuction = await Auction.findOneAndUpdate(
      {
        _id: id,
        status: "scheduled",
        waitingStartedAt: null,
      },
      {
        $set: {
          waitingMinutes: minutes,
          waitingStartedAt: now,
          startsAt,
          endsAt: null,
        },
      },
      {
        new: true,
        runValidators: true,
      }
    );

    if (!updatedAuction) {
      return res.status(409).json({
        message: "A espera deste leilão já foi iniciada.",
      });
    }

    await recordAuctionAuditEvent(updatedAuction._id, "waiting_started", now, "admin", req.user?._id ?? req.user?.id ?? null);
    return res.status(200).json({
      message: "Contagem de espera iniciada com sucesso.",
      auction: updatedAuction,
    });
  } catch (error) {
    console.error("Erro ao iniciar espera do leilão:", error);

    return res.status(500).json({
      message: "Erro interno do servidor.",
    });
  }
};

// Lightweight public snapshot for frequent countdown/price synchronization.
// Never exposes wallet balances, user identity, or bid payment records.
export const getAuctionLiveState = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: "ID do leilão inválido." });
    }
    const auction = await Auction.findById(req.params.id)
      .select("status currentPriceCents bidCount startsAt endsAt bidCostCents winner")
      .lean();
    if (!auction) return res.status(404).json({ message: "Leilão não encontrado." });
    res.set("Cache-Control", "no-store");
    const { winner, ...publicAuction } = auction;
    return res.status(200).json({ auction: { ...publicAuction, winnerNickname: await getPublicWinnerNickname(auction) }, serverTime: new Date().toISOString() });
  } catch (error) {
    console.error("Erro ao consultar estado do leilão:", error);
    return res.status(500).json({ message: "Erro interno do servidor." });
  }
};

export const streamAuctionEvents = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: "ID do leilão inválido." });
  try {
    if (!(await Auction.exists({ _id: req.params.id }))) return res.status(404).json({ message: "Leilão não encontrado." });
    return subscribeAuctionEvents(req, res, req.params.id);
  } catch (error) {
    console.error("Erro ao conectar eventos do leilão:", error);
    return res.status(500).json({ message: "Erro interno do servidor." });
  }
};

export const listPublicWinners = async (_req, res) => {
  try {
    const auctions = await Auction.find({ status: "finished", winner: { $ne: null } })
      .select("product currentPriceCents endsAt winner")
      .populate({ path: "product", model: Product, select: "name coverImage" })
      .sort({ endsAt: -1 })
      .limit(50)
      .lean();
    const winnerIds = [...new Set(auctions.map(a => String(a.winner)))];
    const users = await User.find({ _id: { $in: winnerIds }, publicNickname: { $type: "string" } })
      .select("publicNickname").lean();
    const names = new Map(users.map(u => [String(u._id), u.publicNickname]));
    const winners = auctions.flatMap(a => {
      const nickname = names.get(String(a.winner));
      if (!nickname) return [];
      return [{
        auctionId: String(a._id),
        productName: a.product?.name || "Produto indisponível",
        coverImageUrl: a.product?.coverImage?.url || null,
        finalPriceCents: a.currentPriceCents,
        finishedAt: a.endsAt,
        winnerNickname: nickname,
      }];
    });
    res.set("Cache-Control", "no-store");
    return res.json({ winners });
  } catch (error) {
    console.error("Erro ao listar vencedores:", error);
    return res.status(500).json({ message: "Erro interno do servidor." });
  }
};
