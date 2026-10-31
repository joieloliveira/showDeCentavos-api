import { publishAuctionEvent } from "../services/AuctionEventsService.js";
import mongoose from "mongoose";

import Auction from "../models/Auction.js";
import Bid from "../models/Bid.js";
import User from "../models/User.js";
import WalletTransaction from "../models/WalletTransaction.js";

export const placeBid = async (req, res) => {
    // Fail closed: financial bids require an explicit server-side release switch.
    if (process.env.AUCTION_BIDDING_ENABLED !== "true") {
        return res.status(503).json({ message: "Lances temporariamente indisponíveis." });
    }
    try {
        const { id } = req.params;
        const { idempotencyKey } = req.body ?? {};

        if (!mongoose.isValidObjectId(id)) {
            return res.status(400).json({
                message: "ID do leilão inválido.",
            });
        }

        if (!req.user?.id) {
            return res.status(401).json({
                message: "Usuário não autenticado.",
            });
        }


        if (
            typeof idempotencyKey !== "string" ||
            !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
                idempotencyKey
            )
        ) {
            return res.status(400).json({
                message: "Chave de idempotência inválida. Envie um UUID v4.",
            });
        }

        const existingBid = await Bid.findOne({
            user: req.user.id,
            idempotencyKey,
        });

        if (existingBid) {
            if (existingBid.auction.toString() !== id.toLowerCase()) {
                return res.status(409).json({
                    message: "Esta chave já foi utilizada em outro leilão.",
                });
            }

            return res.status(200).json({
                message: "Este lance já foi registrado anteriormente.",
                bid: existingBid,
                duplicate: true,
            });
        }

        const auction = await Auction.findById(id);


        if (!auction) {
            return res.status(404).json({
                message: "Leilão não encontrado.",
            });
        }

        if (auction.status !== "active") {
            return res.status(409).json({
                message: "Este leilão não está disponível para lances.",
            });
        }

        const now = new Date();

        if (auction.startsAt > now) {
            return res.status(409).json({
                message: "O leilão ainda não começou.",
            });
        }

        // O cronômetro só começa após o primeiro lance.
        if (
            auction.bidCount > 0 &&
            auction.endsAt &&
            auction.endsAt <= now
        ) {
            return res.status(409).json({
                message: "O tempo para realizar lances terminou.",
            });
        }

        const user = await User.findById(req.user.id).select(
            "wallet.balanceCents isActive"
        );

        if (!user || !user.isActive) {
            return res.status(403).json({
                message: "Usuário inexistente ou desativado.",
            });
        }

        const bidCostCents = auction.bidCostCents;
        const balanceCents = user.wallet?.balanceCents ?? 0;

        if (![50, 100].includes(bidCostCents)) {
            return res.status(409).json({
                message: "O custo do lance está configurado incorretamente.",
            });
        }

        if (balanceCents < bidCostCents) {
            return res.status(409).json({
                message: "Saldo insuficiente para realizar este lance.",
                balanceCents,
                bidCostCents,
            });
        }

        const session = await mongoose.startSession();
        let bidResult = null;

        try {
            await session.withTransaction(async () => {
                bidResult = null;

                const existingBidInTransaction = await Bid.findOne({
                    user: req.user.id,
                    idempotencyKey,
                }).session(session);

                if (existingBidInTransaction) {
                    throw new Error("BID_ALREADY_EXISTS");
                }

                const auctionInTransaction = await Auction.findById(id)
                    .session(session);

                if (!auctionInTransaction) {
                    throw new Error("AUCTION_NOT_FOUND");
                }

                if (auctionInTransaction.status !== "active") {
                    throw new Error("AUCTION_NOT_ACTIVE");
                }

                const transactionNow = new Date();

                if (
                    !auctionInTransaction.startsAt ||
                    auctionInTransaction.startsAt > transactionNow
                ) {
                    throw new Error("AUCTION_NOT_STARTED");
                }

                if (
                    auctionInTransaction.bidCount > 0 &&
                    auctionInTransaction.endsAt &&
                    auctionInTransaction.endsAt <= transactionNow
                ) {
                    throw new Error("AUCTION_EXPIRED");
                }


                const bidCost = auctionInTransaction.bidCostCents;

                if (![50, 100].includes(bidCost)) {
                    throw new Error("INVALID_BID_COST");
                }

                const updatedUser = await User.findOneAndUpdate(
                    {
                        _id: req.user.id,
                        isActive: true,
                        "wallet.balanceCents": { $gte: bidCost },
                    },
                    {
                        $inc: {
                            "wallet.balanceCents": -bidCost,
                        },
                    },
                    {
                        returnDocument: "after",
                        session,
                        runValidators: true,
                    }
                );

                if (!updatedUser) {
                    throw new Error("INSUFFICIENT_BALANCE");
                }

                const balanceAfterCents =
                    updatedUser.wallet.balanceCents;


                const priceBeforeCents =
                    auctionInTransaction.currentPriceCents;

                const priceAfterCents =
                    priceBeforeCents + auctionInTransaction.bidIncrementCents;

                const bidNow = new Date();

                const expiresAt = new Date(
                    bidNow.getTime() +
                    auctionInTransaction.durationSeconds * 1000
                );

                const updatedAuction = await Auction.findOneAndUpdate(
                    {
                        _id: id,
                        status: "active",
                        bidCount: auctionInTransaction.bidCount,
                        $or: [
                            { bidCount: 0 },
                            { endsAt: { $gt: bidNow } },
                        ],
                    },
                    {
                        $inc: {
                            currentPriceCents: auctionInTransaction.bidIncrementCents,
                            bidCount: 1,
                        },
                        $set: {
                            lastBidder: req.user.id,
                            endsAt: expiresAt,
                        },
                    },
                    {
                        returnDocument: "after",
                        session,
                        runValidators: true,
                    }
                );

                if (!updatedAuction) {
                    throw new Error("AUCTION_STATE_CHANGED");
                }


                const [createdBid] = await Bid.create(
                    [
                        {
                            auction: updatedAuction._id,
                            user: req.user.id,
                            idempotencyKey,
                            bidCostCents: bidCost,
                            priceBeforeCents,
                            priceAfterCents,
                            balanceAfterCents,
                            expiresAt,
                        },
                    ],
                    { session }
                );


                if (!createdBid) {
                    throw new Error("BID_CREATION_FAILED");
                }

                await WalletTransaction.create(
                    [
                        {
                            user: req.user.id,
                            type: "bid",
                            amountCents: -bidCost,
                            balanceAfterCents,
                            auction: updatedAuction._id,
                            bid: createdBid._id,
                            description: "Débito referente a lance em leilão.",
                        },
                    ],
                    { session }
                );

                bidResult = {

                    bid: createdBid,
                    auctionId: updatedAuction._id,
                    currentPriceCents: updatedAuction.currentPriceCents,
                    bidCount: updatedAuction.bidCount,
                    balanceAfterCents,
                    expiresAt,
                };

            });

            publishAuctionEvent(id, {
                status: "active",
                currentPriceCents: bidResult.currentPriceCents,
                bidCount: bidResult.bidCount,
                endsAt: bidResult.expiresAt,
            });
            return res.status(201).json({
                message: "Lance registrado com sucesso.",
                ...bidResult,
            });

        } catch (error) {
            const knownErrors = {
                AUCTION_NOT_FOUND: {
                    status: 404,
                    message: "Leilão não encontrado.",
                },
                AUCTION_NOT_ACTIVE: {
                    status: 409,
                    message: "Este leilão não está ativo.",
                },
                AUCTION_NOT_STARTED: {
                    status: 409,
                    message: "O leilão ainda não começou.",
                },
                AUCTION_EXPIRED: {
                    status: 409,
                    message: "O tempo para realizar lances terminou.",
                },
                INVALID_BID_COST: {
                    status: 409,
                    message: "Custo do lance inválido.",
                },
                INSUFFICIENT_BALANCE: {
                    status: 409,
                    message: "Saldo insuficiente ou usuário desativado.",
                },
                AUCTION_STATE_CHANGED: {
                    status: 409,
                    message: "O leilão foi atualizado. Tente novamente.",
                },
                BID_CREATION_FAILED: {
                    status: 500,
                    message: "Não foi possível registrar o lance.",
                },
            };


            if (error.message === "BID_ALREADY_EXISTS") {
                const existingBid = await Bid.findOne({
                    user: req.user.id,
                    idempotencyKey,
                });

                if (existingBid) {
                    if (existingBid.auction.toString() !== id.toLowerCase()) {
                        return res.status(409).json({
                            message: "Esta chave já foi utilizada em outro leilão.",
                        });
                    }

                    return res.status(200).json({
                        message: "Este lance já foi registrado anteriormente.",
                        bid: existingBid,
                        duplicate: true,
                    });
                }

                return res.status(409).json({
                    message: "Não foi possível confirmar o lance anterior.",
                });
            }

            const knownError = knownErrors[error.message];

            if (knownError) {
                return res.status(knownError.status).json({
                    message: knownError.message,
                });
            }

            if (error.code === 11000) {
                const existingBid = await Bid.findOne({
                    user: req.user.id,
                    idempotencyKey,
                });

                if (existingBid) {
                    if (existingBid.auction.toString() !== id.toLowerCase()) {
                        return res.status(409).json({
                            message: "Esta chave já foi utilizada em outro leilão.",
                        });
                    }

                    return res.status(200).json({
                        message: "Este lance já foi registrado anteriormente.",
                        bid: existingBid,
                        duplicate: true,
                    });
                }

                return res.status(409).json({
                    message: "Conflito ao registrar o lance. Consulte a tentativa antes de reenviar.",
                });
            }



            if (
                error.hasErrorLabel?.("TransientTransactionError") ||
                error.hasErrorLabel?.("UnknownTransactionCommitResult") ||
                error.code === 112
            ) {
                const existingBid = await Bid.findOne({
                    user: req.user.id,
                    idempotencyKey,
                });

                if (existingBid) {
                    if (existingBid.auction.toString() !== id.toLowerCase()) {
                        return res.status(409).json({
                            message: "Esta chave já foi utilizada em outro leilão.",
                        });
                    }

                    return res.status(200).json({
                        message: "Lance já registrado anteriormente.",
                        bid: existingBid,
                        duplicate: true,
                    });
                }

                return res.status(503).json({
                    message:
                        "Não foi possível confirmar o lance. Consulte novamente usando a mesma chave de idempotência.",
                    idempotencyKey,
                });
            }

            console.error("Erro na transação do lance:", error);

            return res.status(500).json({
                message: "Erro interno ao processar o lance.",
            });
        } finally {
            await session.endSession();
        }

    } catch (error) {
        console.error("Erro ao processar lance:", error);

        return res.status(500).json({
            message: "Erro interno do servidor.",
        });
    }
};


export const getBidByIdempotencyKey = async (req, res) => {
    try {
        if (!req.user?.id) {
            return res.status(401).json({
                message: "Usuário não autenticado.",
            });
        }

        const { idempotencyKey } = req.params;

        if (
            typeof idempotencyKey !== "string" ||
            !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
                idempotencyKey
            )
        ) {
            return res.status(400).json({
                message: "Chave de idempotência inválida.",
            });
        }

        const bid = await Bid.findOne({
            user: req.user.id,
            idempotencyKey,
        });

        if (!bid) {
            return res.status(404).json({
                message: "Nenhum lance encontrado para esta chave.",
            });
        }

        return res.status(200).json({
            message: "Lance encontrado.",
            bid,
        });
    } catch (error) {
        console.error("Erro ao consultar lance:", error);

        return res.status(500).json({
            message: "Erro interno ao consultar o lance.",
        });
    }
};
