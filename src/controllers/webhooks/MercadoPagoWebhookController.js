import mongoose from "mongoose";

import Order from "../../models/Order.js";

import {
  WebhookSignatureValidator,
  InvalidWebhookSignatureError,
} from "mercadopago";

import MercadoPagoProvider from "../../services/payments/MercadoPagoProvider.js";

import { processApprovedOrder } from "../../services/OrderPaymentService.js";

const paymentProvider = MercadoPagoProvider;

export const mercadoPagoOrderWebhook = async (
  req,
  res
) => {
  let session = null;

  try {
    /*
     * =================================================
     * 1. DADOS RECEBIDOS
     * =================================================
     */

    const xSignature =
      req.headers["x-signature"];

    const xRequestId =
      req.headers["x-request-id"];

    const mercadoPagoOrderId =
      req.query["data.id"] ||
      req.body?.data?.id;

    const notificationId =
      req.body?.id
        ? String(req.body.id)
        : null;

    const type =
      req.query.type ||
      req.body?.type;

    console.log(
      "Webhook Mercado Pago recebido:",
      {
        type,
        mercadoPagoOrderId,
      }
    );

    if (!mercadoPagoOrderId) {
      console.log(
        "Webhook ignorado: data.id ausente."
      );

      return res.sendStatus(200);
    }

    /*
     * =================================================
     * 2. VALIDA ASSINATURA
     * =================================================
     */

    if (
      !xSignature ||
      !xRequestId ||
      !process.env.MERCADOPAGO_WEBHOOK_SECRET
    ) {
      console.error(
        "Webhook sem informações necessárias para validar assinatura."
      );

      return res.sendStatus(401);
    }

    WebhookSignatureValidator.validate({
      xSignature,
      xRequestId,

      dataId:
        String(mercadoPagoOrderId),

      secret:
        process.env.MERCADOPAGO_WEBHOOK_SECRET,
    });

    /*
     * Tratamos somente notificações de Order.
     */

    if (
      type &&
      type !== "order"
    ) {
      console.log(
        `Webhook ignorado. Tipo: ${type}`
      );

      return res.sendStatus(200);
    }

    /*
     * Algumas notificações podem chegar com PAY...
     * em vez de ORDTST...
     *
     * Não tentamos consultar /v1/orders/PAY...
     */

    if (
      String(mercadoPagoOrderId)
        .startsWith("PAY")
    ) {
      console.log(
        "Webhook ignorado: recebido paymentId em evento de Order:",
        mercadoPagoOrderId
      );

      return res.sendStatus(200);
    }

    /*
     * =================================================
     * 3. CONSULTA ORDER NO PROVIDER
     * =================================================
     */

    const providerOrder =
      await paymentProvider.getOrder(
        mercadoPagoOrderId
      );

    if (!providerOrder) {
      console.error(
        "Não foi possível consultar a Order no Mercado Pago."
      );

      return res.sendStatus(200);
    }

    /*
     * =================================================
     * 4. LOCALIZA NOSSA ORDER
     * =================================================
     */

    const internalOrderId =
      providerOrder.externalReference;

    if (!internalOrderId) {
      console.error(
        "Order Mercado Pago sem external_reference:",
        providerOrder.orderId
      );

      return res.sendStatus(200);
    }

    const currentOrder =
      await Order.findById(
        internalOrderId
      );

    if (!currentOrder) {
      console.error(
        "Order interna não encontrada:",
        internalOrderId
      );

      return res.sendStatus(200);
    }

    /*
     * =================================================
     * 5. IDEMPOTÊNCIA
     * =================================================
     */

    if (
      currentOrder.payment?.processedAt &&
      (
        currentOrder.payment
          ?.processedProviderOrderId ===
        String(providerOrder.orderId)
        ||
        currentOrder.payment
          ?.processedMercadoPagoOrderId ===
        String(providerOrder.orderId)
      )
    ) {
      console.log(
        "Pagamento já processado anteriormente:",
        providerOrder.orderId
      );

      return res.sendStatus(200);
    }

    /*
     * =================================================
     * 6. PAGAMENTO APROVADO
     * =================================================
     */

    if (
      providerOrder.normalizedStatus ===
      "approved"
    ) {
      await processApprovedOrder({
        internalOrderId,
        providerOrder,
        notificationId,
      });

      return res.sendStatus(200);
    }

    /*
     * =================================================
     * 7. FALHA / CANCELAMENTO / EXPIRAÇÃO
     * =================================================
     */

    const statusesThatReleaseStock = [
      "failed",
      "cancelled",
    ];

    if (
      statusesThatReleaseStock.includes(
        providerOrder.normalizedStatus
      )
    ) {
      session =
        await mongoose.startSession();

      await session.withTransaction(
        async () => {
          const order =
            await Order.findById(
              internalOrderId
            ).session(session);

          if (!order) {
            return;
          }

          /*
           * Libera reserva de estoque
           * somente se ainda estiver ativa.
           */

          if (
            order.stockReservation
              ?.reserved
          ) {
            for (
              const item of order.items
            ) {
              const result =
                await Product.updateOne(
                  {
                    _id:
                      item.product,

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
                result.modifiedCount !==
                1
              ) {
                throw new Error(
                  `Falha ao liberar estoque reservado do produto ${item.product}`
                );
              }
            }

            order.stockReservation.reserved =
              false;

            order.stockReservation.releasedAt =
              new Date();
          }

          /*
           * Atualiza estado do pagamento.
           */

          switch (
          providerOrder.status
          ) {
            case "failed":
              order.paymentStatus =
                "failed";
              break;

            case "canceled":
            case "cancelled":
            case "expired":
              order.paymentStatus =
                "cancelled";
              break;
          }

          /*
           * Campos genéricos.
           */

          order.payment.provider =
            "mercadopago";

          order.payment.providerOrderId =
            String(
              providerOrder.orderId
            );

          if (
            providerOrder.payment?.id
          ) {
            order.payment.providerPaymentId =
              String(
                providerOrder.payment.id
              );
          }

          /*
           * Campos antigos do Mercado Pago.
           * Mantemos durante a migração.
           */

          order.payment.mercadoPagoOrderId =
            String(
              providerOrder.orderId
            );

          if (
            providerOrder.payment?.id
          ) {
            order.payment.paymentId =
              String(
                providerOrder.payment.id
              );
          }

          if (notificationId) {
            order.payment.lastWebhookNotificationId =
              notificationId;
          }

          await order.save({
            session,
          });
        }
      );

      return res.sendStatus(200);
    }

    /*
     * =================================================
     * 8. REFUND
     * =================================================
     *
     * Não devolvemos estoque automaticamente aqui.
     * Isso pode precisar de uma regra própria depois.
     */

    if (
      providerOrder.normalizedStatus ===
      "refunded"
    ) {
      currentOrder.paymentStatus =
        "refunded";

      currentOrder.payment.provider =
        "mercadopago";

      /*
       * Campos genéricos.
       */

      currentOrder.payment.providerOrderId =
        String(
          providerOrder.orderId
        );

      if (
        providerOrder.payment?.id
      ) {
        currentOrder.payment.providerPaymentId =
          String(
            providerOrder.payment.id
          );
      }

      /*
       * Campos legados.
       */

      currentOrder.payment.mercadoPagoOrderId =
        String(
          providerOrder.orderId
        );

      if (
        providerOrder.payment?.id
      ) {
        currentOrder.payment.paymentId =
          String(
            providerOrder.payment.id
          );
      }

      if (notificationId) {
        currentOrder.payment.lastWebhookNotificationId =
          notificationId;
      }

      await currentOrder.save();

      return res.sendStatus(200);
    }

    /*
     * =================================================
     * 9. AINDA PENDENTE
     * =================================================
     *
     * Exemplos:
     * action_required
     * created
     * pending
     */

    currentOrder.paymentStatus =
      "pending";

    currentOrder.payment.provider =
      "mercadopago";

    /*
     * Campos genéricos.
     */

    currentOrder.payment.providerOrderId =
      String(
        providerOrder.orderId
      );

    if (
      providerOrder.payment?.id
    ) {
      currentOrder.payment.providerPaymentId =
        String(
          providerOrder.payment.id
        );
    }

    /*
     * Campos legados.
     */

    currentOrder.payment.mercadoPagoOrderId =
      String(
        providerOrder.orderId
      );

    if (
      providerOrder.payment?.id
    ) {
      currentOrder.payment.paymentId =
        String(
          providerOrder.payment.id
        );
    }

    if (notificationId) {
      currentOrder.payment.lastWebhookNotificationId =
        notificationId;
    }

    await currentOrder.save();

    return res.sendStatus(200);

  } catch (error) {
    /*
     * =================================================
     * ASSINATURA INVÁLIDA
     * =================================================
     */

    if (
      error instanceof
      InvalidWebhookSignatureError
    ) {
      console.error(
        "Webhook Mercado Pago com assinatura inválida."
      );

      return res.sendStatus(401);
    }

    /*
     * 500 permite que o Mercado Pago
     * tente novamente.
     */

    console.error(
      "Erro no webhook de Order do Mercado Pago:",
      error.response?.data ||
      error.message ||
      error
    );

    return res.sendStatus(500);

  } finally {
    if (session) {
      await session.endSession();
    }
  }
};