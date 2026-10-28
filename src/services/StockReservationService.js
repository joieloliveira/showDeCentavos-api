import mongoose from "mongoose";

import Order from "../models/Order.js";
import Product from "../models/Product.js";

import {
    getPaymentProviderByName,
} from "./payments/PaymentProvider.js";

import {
    processApprovedOrder,
} from "./OrderPaymentService.js";

export const reserveOrderStock = async (
    orderId
) => {
    let session = null;

    try {
        session =
            await mongoose.startSession();

        await session.withTransaction(
            async () => {
                const order =
                    await Order.findById(
                        orderId
                    ).session(session);

                if (!order) {
                    throw new Error(
                        "Pedido não encontrado."
                    );
                }

                if (
                    order.status !== "pending" ||
                    order.paymentStatus !== "pending"
                ) {
                    throw new Error(
                        "Não é possível reservar estoque para um pedido que não está pendente."
                    );
                }

                /*
                 * Outra requisição pode já
                 * ter reservado este pedido.
                 */

                /*
                 * Outra requisição pode já
                 * ter reservado este pedido.
                 */
                if (
                    order.stockReservation
                        ?.reserved
                ) {
                    return;
                }

                for (
                    const item of order.items
                ) {
                    const result =
                        await Product.updateOne(
                            {
                                _id:
                                    item.product,

                                $expr: {
                                    $gte: [
                                        {
                                            $subtract: [
                                                "$stock",

                                                {
                                                    $ifNull: [
                                                        "$reservedStock",
                                                        0,
                                                    ],
                                                },
                                            ],
                                        },

                                        item.quantity,
                                    ],
                                },
                            },

                            {
                                $inc: {
                                    reservedStock:
                                        item.quantity,
                                },
                            },

                            {
                                session,
                            }
                        );

                    if (
                        result.modifiedCount !==
                        1
                    ) {
                        throw new Error(
                            `Estoque disponível insuficiente para o produto ${item.product}`
                        );
                    }
                }

                const now =
                    new Date();

                const expiresAt =
                    new Date(
                        now.getTime() +
                        30 * 60 * 1000
                    );

                order.stockReservation.reserved =
                    true;

                order.stockReservation.reservedAt =
                    now;

                order.stockReservation.expiresAt =
                    expiresAt;

                order.stockReservation.releasedAt =
                    null;

                await order.save({
                    session,
                });
            }
        );

        return await Order.findById(
            orderId
        );
    } finally {
        if (session) {
            await session.endSession();
        }
    }
};

export const reconcileExpiredReservations = async () => {
    const now = new Date();

    const orders = await Order.find({
        "stockReservation.reserved": true,

        "stockReservation.expiresAt": {
            $lte: now,
        },

        paymentStatus: "pending",
    });

    const results = [];

    for (const order of orders) {
        let session = null;

        try {
            /*
             * Consulta o estado real do pagamento
             * através do provider configurado.
             */

            let providerOrder = null;

            const providerName =
                order.payment?.provider ||
                "mercadopago";

            const paymentProvider =
                getPaymentProviderByName(
                    providerName
                );

            const providerOrderId =
                order.payment?.providerOrderId ||
                order.payment?.mercadoPagoOrderId;

            if (providerOrderId) {
                providerOrder =
                    await paymentProvider.getOrder(
                        providerOrderId
                    );
            } if (
                !providerOrderId &&
                ["preparing", "submitted"].includes(
                    order.payment?.attemptStatus
                )
            ) {
                results.push({
                    orderId: order._id,
                    action: "payment_attempt_in_progress",
                });

                continue;
            }

            /*
             * ====================================
             * CASO 1 — PAGAMENTO FOI APROVADO
             * ====================================
             */

            if (
                providerOrder?.normalizedStatus ===
                "approved"
            ) {
                const result =
                    await processApprovedOrder({
                        internalOrderId:
                            order._id,

                        providerOrder,
                    });

                results.push({
                    orderId:
                        order._id,

                    action:
                        result.processed
                            ? "payment_processed"
                            : "already_processed",
                });

                continue;
            }

            if (
                providerOrder?.normalizedStatus === "pending"
            ) {
                results.push({
                    orderId: order._id,
                    action: "payment_still_pending",
                });

                continue;
            }

            /*
             * ====================================
             * CASO 2 — RESERVA EXPIRADA
             * ====================================
             */

            session =
                await mongoose.startSession();

            await session.withTransaction(
                async () => {
                    const currentOrder = await Order.findOne({
                        _id: order._id,
                        "stockReservation.reserved": true,
                        paymentStatus: "pending",
                        status: "pending",
                        "payment.processedAt": null,
                    }).session(session);

                    /*
                     * Outra rotina pode já ter
                     * liberado esta reserva.
                     */

                    if (!currentOrder) {
                        return;
                    }

                    for (
                        const item of currentOrder.items
                    ) {
                        const result =
                            await Product.updateOne(
                                {
                                    _id: item.product,

                                    reservedStock: {
                                        $gte:
                                            item.quantity,
                                    },
                                },

                                {
                                    $inc: {
                                        reservedStock:
                                            -item.quantity,
                                    },
                                },

                                {
                                    session,
                                }
                            );

                        if (
                            result.modifiedCount !== 1
                        ) {
                            throw new Error(
                                `Não foi possível liberar a reserva do produto ${item.product}`
                            );
                        }
                    }

                    currentOrder.stockReservation.reserved =
                        false;

                    currentOrder.stockReservation.releasedAt =
                        new Date();

                    /*
                     * O pedido não foi pago.
                     */

                    currentOrder.paymentStatus =
                        "cancelled";

                    currentOrder.status =
                        "cancelled";

                    currentOrder.items.forEach(
                        (item) => {
                            if (
                                item.status ===
                                "pending"
                            ) {
                                item.status =
                                    "cancelled";
                            }
                        }
                    );

                    await currentOrder.save({
                        session,
                    });
                }
            );

            results.push({
                orderId: order._id,
                action: "reservation_released",
            });

        } catch (error) {
            console.error(
                `Erro ao reconciliar Order ${order._id}:`,
                error.response?.data ||
                error.message ||
                error
            );

            results.push({
                orderId: order._id,
                action: "error",
                error: error.message,
            });

        } finally {
            if (session) {
                await session.endSession();
            }
        }
    }

    return {
        checked: orders.length,
        results,
    };
};