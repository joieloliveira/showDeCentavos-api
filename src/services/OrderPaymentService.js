import mongoose from "mongoose";

import Order from "../models/Order.js";
import Product from "../models/Product.js";

export const processApprovedOrder = async ({
  internalOrderId,
  providerOrder,
  notificationId = null,
}) => {
  if (providerOrder?.normalizedStatus !== "approved") {
    throw new Error(
      `Não é possível confirmar o pedido: pagamento não aprovado. Status recebido: ${providerOrder?.normalizedStatus ?? "indefinido"}`
    );
  }

  let session = null;

  try {
    session = await mongoose.startSession();

    let processed = false;

    await session.withTransaction(async () => {
      /*
       * Por enquanto Mercado Pago retorna:
       *
       * providerOrder.transactions.payments[0]
       *
       * Quando adicionarmos Pagar.me,
       * o PagarmeProvider deverá normalizar
       * sua resposta para esse formato comum.
       */
      const providerOrderId =
        String(providerOrder.orderId);

      const providerPaymentId =
        providerOrder.payment?.id
          ? String(providerOrder.payment.id)
          : null;

      /*
       * Só uma requisição pode processar
       * uma Order ainda não finalizada.
       */
      const order =
        await Order.findOneAndUpdate(
          {
            _id: internalOrderId,
            "payment.processedAt": null,
          },

          {
            $set: {
              paymentStatus: "paid",

              status: "processing",

              /*
               * CAMPOS GENÉRICOS
               */

              "payment.providerOrderId":
                providerOrderId,

              "payment.processedProviderOrderId":
                providerOrderId,

              ...(providerPaymentId
                ? {
                  "payment.providerPaymentId":
                    providerPaymentId,
                }
                : {}),

              "payment.processedAt":
                new Date(),

              /*
               * CAMPOS LEGADOS DO MP
               *
               * Mantemos enquanto a migração
               * ainda está em andamento.
               */
              ...(providerOrderId
                ? {
                  "payment.mercadoPagoOrderId":
                    providerOrderId,

                  "payment.processedMercadoPagoOrderId":
                    providerOrderId,
                }
                : {}),

              ...(providerPaymentId
                ? {
                  "payment.paymentId":
                    providerPaymentId,
                }
                : {}),

              ...(notificationId
                ? {
                  "payment.lastWebhookNotificationId":
                    String(notificationId),
                }
                : {}),
            },
          },

          {
            returnDocument: "after",
            session,
          }
        );

      /*
       * Outra requisição já processou.
       */
      if (!order) {
        return;
      }

      /*
       * Para confirmar uma venda,
       * esperamos que exista reserva ativa.
       */
      if (
        !order.stockReservation
          ?.reserved
      ) {
        throw new Error(
          `Order ${order._id} não possui reserva de estoque ativa.`
        );
      }

      /*
       * Confirma o estoque:
       *
       * stock diminui
       * reservedStock diminui
       * sales aumenta
       */
      for (const item of order.items) {
        const result =
          await Product.updateOne(
            {
              _id: item.product,

              stock: {
                $gte: item.quantity,
              },

              reservedStock: {
                $gte: item.quantity,
              },
            },

            {
              $inc: {
                stock:
                  -item.quantity,

                reservedStock:
                  -item.quantity,

                sales:
                  item.quantity,
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
            `Falha ao confirmar estoque reservado do produto ${item.product}`
          );
        }
      }

      /*
       * Libera marcador da reserva.
       */
      order.stockReservation.reserved =
        false;

      order.stockReservation.releasedAt =
        new Date();

      /*
       * Atualiza os itens.
       */
      order.items.forEach((item) => {
        if (
          item.status === "pending"
        ) {
          item.status =
            "processing";
        }
      });

      await order.save({
        session,
      });

      processed = true;
    });

    return {
      processed,
    };

  } finally {
    if (session) {
      await session.endSession();
    }
  }
};