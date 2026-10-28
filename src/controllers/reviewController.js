import mongoose from "mongoose";

import Review from "../models/Review.js";
import Product from "../models/Product.js";

export const createReview = async (req, res) => {
  try {
    const { productId } = req.params;
    const { rating, comment } = req.body;

    if (!rating) {
      return res.status(400).json({
        message: "A nota é obrigatória.",
      });
    }

    const numericRating = Number(rating);

    if (
      !Number.isInteger(numericRating) ||
      numericRating < 1 ||
      numericRating > 5
    ) {
      return res.status(400).json({
        message: "A nota deve ser um número inteiro entre 1 e 5.",
      });
    }

    const product = await Product.findOne({
      _id: productId,
      status: "active",
    });

    if (!product) {
      return res.status(404).json({
        message: "Produto não encontrado.",
      });
    }

    const existingReview = await Review.findOne({
      product: productId,
      user: req.user.id,
    });

    if (existingReview) {
      return res.status(409).json({
        message: "Você já avaliou este produto.",
      });
    }

    const review = await Review.create({
      product: productId,
      user: req.user.id,
      rating: numericRating,
      comment: comment || null,
    });

    await review.populate(
      "user",
      "name avatar"
    );

    return res.status(201).json({
      message: "Avaliação criada com sucesso.",
      review,
    });
  } catch (error) {
    console.error(
      "Erro ao criar avaliação:",
      error
    );

    return res.status(500).json({
      message: "Erro interno do servidor.",
    });
  }
};

export const listProductReviews = async (
  req,
  res
) => {
  try {
    const { productId } = req.params;

    const requestedPage =
      Number(req.query.page) || 1;

    const requestedLimit =
      Number(req.query.limit) || 10;

    const page = Math.max(
      requestedPage,
      1
    );

    const limit = Math.min(
      Math.max(requestedLimit, 1),
      50
    );

    const skip =
      (page - 1) * limit;

    const filter = {
      product: productId,
      isActive: true,
    };

    const [
      reviews,
      totalReviews,
      ratingStats,
    ] = await Promise.all([
      Review.find(filter)
        .populate(
          "user",
          "name avatar"
        )
        .sort({
          createdAt: -1,
        })
        .skip(skip)
        .limit(limit),

      Review.countDocuments(filter),

      Review.aggregate([
        {
          $match: {
            product:
              new mongoose.Types.ObjectId(
                productId
              ),
            isActive: true,
          },
        },
        {
          $group: {
            _id: null,
            averageRating: {
              $avg: "$rating",
            },
            totalRatings: {
              $sum: 1,
            },
          },
        },
      ]),
    ]);

    const stats = ratingStats[0] || {
      averageRating: 0,
      totalRatings: 0,
    };

    return res.status(200).json({
      reviews,

      rating: {
        average: Number(
          stats.averageRating.toFixed?.(2) ||
            0
        ),
        total: stats.totalRatings,
      },

      pagination: {
        totalReviews,
        page,
        limit,
        totalPages: Math.ceil(
          totalReviews / limit
        ),
      },
    });
  } catch (error) {
    console.error(
      "Erro ao listar avaliações:",
      error
    );

    return res.status(500).json({
      message: "Erro interno do servidor.",
    });
  }
};

export const updateReview = async (req, res) => {
  try {
    const { id } = req.params;
    const { rating, comment } = req.body;

    const review = await Review.findById(id);

    if (!review) {
      return res.status(404).json({
        message: "Avaliação não encontrada.",
      });
    }

    if (review.user.toString() !== req.user.id) {
      return res.status(403).json({
        message: "Você não pode editar esta avaliação.",
      });
    }

    if (rating !== undefined) {
      const numericRating = Number(rating);

      if (
        !Number.isInteger(numericRating) ||
        numericRating < 1 ||
        numericRating > 5
      ) {
        return res.status(400).json({
          message: "A nota deve ser um número inteiro entre 1 e 5.",
        });
      }

      review.rating = numericRating;
    }

    if (comment !== undefined) {
      review.comment = comment || null;
    }

    await review.save();

    await review.populate(
      "user",
      "name avatar"
    );

    return res.status(200).json({
      message: "Avaliação atualizada com sucesso.",
      review,
    });
  } catch (error) {
    console.error(
      "Erro ao atualizar avaliação:",
      error
    );

    return res.status(500).json({
      message: "Erro interno do servidor.",
    });
  }
};

export const deleteReview = async (req, res) => {
  try {
    const { id } = req.params;

    const review = await Review.findById(id);

    if (!review) {
      return res.status(404).json({
        message: "Avaliação não encontrada.",
      });
    }

    const isOwner =
      review.user.toString() === req.user.id;

    const isAdmin =
      req.user.role === "admin";

    if (!isOwner && !isAdmin) {
      return res.status(403).json({
        message: "Você não pode excluir esta avaliação.",
      });
    }

    await review.deleteOne();

    return res.status(200).json({
      message: "Avaliação excluída com sucesso.",
    });
  } catch (error) {
    console.error(
      "Erro ao excluir avaliação:",
      error
    );

    return res.status(500).json({
      message: "Erro interno do servidor.",
    });
  }
};