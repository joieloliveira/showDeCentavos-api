
import mongoose from "mongoose";
import Auction from "../models/Auction.js";
import Product from "../models/Product.js";

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
      .sort({ createdAt: -1 });

    return res.status(200).json({
      auctions,
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

    return res.status(200).json({
      auction,
    });
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
