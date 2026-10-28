import Order from "../models/Order.js";

import {
  reserveOrderStock,
} from "../services/StockReservationService.js";

import {
  getPaymentProvider,
  getPaymentProviderByName,
} from "../services/payments/PaymentProvider.js";

import {
  processApprovedOrder,
} from "../services/OrderPaymentService.js";

const paymentProvider = getPaymentProvider();

/*
 * =====================================================
 * CRIA PAGAMENTO PIX
 * =====================================================
 */

export const createPixPayment = async (req, res) => {
  try {
    const { orderId } = req.params;

    const order = await Order.findById(orderId);

    if (!order) {
      return res.status(404).json({
        message: "Pedido não encontrado.",
      });
    }

    if (order.buyer.toString() !== req.user.id) {
      return res.status(403).json({
        message: "Você não pode pagar este pedido.",
      });
    }

    if (order.paymentStatus === "paid") {
      return res.status(400).json({
        message: "Este pedido já está pago.",
      });
    }

    if (
      order.payment?.paymentMethod === "card" ||
      order.payment?.attemptStatus === "preparing" ||
      order.payment?.attemptStatus === "submitted"
    ) {
      return res.status(409).json({
        message:
          "Este pedido já possui uma tentativa de pagamento em andamento. Aguarde a confirmação do resultado antes de iniciar outro pagamento.",
      });
    }

    /*
     * =================================================
     * 1. RESERVA DE ESTOQUE
     * =================================================
     */

    /*
 * =================================================
 * 1. REGISTRA A TENTATIVA PIX
 * =================================================
 */

    const pixIdempotencyKey =
      paymentProvider.generateIdempotencyKey();

    const claimedPixOrder = await Order.findOneAndUpdate(
      {
        _id: orderId,
        status: "pending",
        paymentStatus: "pending",
        "payment.idempotencyKey": null,
        "payment.providerOrderId": null,
        "payment.mercadoPagoOrderId": null,
      },
      {
        $set: {
          "payment.idempotencyKey": pixIdempotencyKey,
          "payment.paymentMethod": "pix",
          "payment.attemptStatus": "preparing",
          "payment.attemptStartedAt": new Date(),
          "payment.provider": paymentProvider.name,
        },
      },
      {
        returnDocument: "after",
      }
    );

    if (!claimedPixOrder) {
      return res.status(409).json({
        message:
          "Este pedido já possui uma tentativa de pagamento associada.",
      });
    }

    /*
 * =================================================
 * 2. RESERVA DE ESTOQUE
 * =================================================
 */

    try {
      await reserveOrderStock(orderId);
    } catch (error) {
      await Order.updateOne(
        {
          _id: orderId,
          "payment.idempotencyKey": pixIdempotencyKey,
          "payment.attemptStatus": "preparing",
          "payment.providerOrderId": null,
          "payment.mercadoPagoOrderId": null,
        },
        {
          $set: {
            "payment.idempotencyKey": null,
            "payment.paymentMethod": null,
            "payment.attemptStatus": null,
            "payment.attemptStartedAt": null,
            "payment.provider": null,
          },
        }
      );

      throw error;
    }
    /*
 * =================================================
 * 3. CONSULTA O PEDIDO COM A TENTATIVA PIX REGISTRADA
 * =================================================
 */

    const updatedOrder =
      await Order.findById(orderId);

    if (!updatedOrder) {
      return res.status(404).json({
        message: "Pedido não encontrado.",
      });
    }

    /*
  * =================================================
  * 3. REGISTRA O ENVIO DA TENTATIVA PIX
  * =================================================
  */

    const submitPixResult = await Order.updateOne(
      {
        _id: orderId,
        "payment.idempotencyKey": pixIdempotencyKey,
        "payment.attemptStatus": "preparing",
      },
      {
        $set: {
          "payment.attemptStatus": "submitted",
        },
      }
    );

    if (submitPixResult.matchedCount !== 1) {
      return res.status(409).json({
        message:
          "Não foi possível confirmar a tentativa de pagamento. Nenhuma cobrança foi enviada por esta requisição.",
      });
    }

    /*
     * =================================================
     * 4. CRIA PIX NO PROVIDER ATUAL
     * =================================================
     */

    let providerOrder;

    try {
      providerOrder =
        await paymentProvider.createPayment({
          order: updatedOrder,

          payer: {
            email: "test_user_br@testuser.com",
            first_name: "APRO",
          },

          idempotencyKey: pixIdempotencyKey,

          method: "pix",
        });
    } catch (error) {
      console.error(
        "Resultado da tentativa PIX desconhecido:",
        error.response?.data || error.message
      );

      return res.status(502).json({
        message:
          "Não foi possível confirmar o resultado da tentativa PIX. Não tente pagar novamente este pedido até verificarmos a tentativa.",
      });
    }

    /*
     * =================================================
     * 4. SALVA DADOS DO PAGAMENTO
     * =================================================
     */

    if (
      providerOrder.externalReference !==
      updatedOrder._id.toString()
    ) {
      return res.status(502).json({
        message:
          "A referência do pagamento PIX não corresponde ao pedido. A tentativa foi preservada para verificação.",
      });
    }

    const savePixResult = await Order.updateOne(
      {
        _id: orderId,
        "payment.idempotencyKey": pixIdempotencyKey,
        "payment.attemptStatus": "submitted",
      },
      {
        $set: {
          "payment.provider": paymentProvider.name,
          "payment.providerOrderId": providerOrder.orderId,
          "payment.mercadoPagoOrderId": providerOrder.orderId,
          "payment.providerPaymentId":
            providerOrder.payment?.id || null,
          "payment.paymentId":
            providerOrder.payment?.id || null,
          "payment.paymentMethod": "pix",
          "payment.attemptStatus": "resolved",
        },
      }
    );

    if (savePixResult.matchedCount !== 1) {
      return res.status(502).json({
        message:
          "O pagamento PIX foi enviado, mas não foi possível registrar seu resultado. Não tente pagar novamente este pedido até verificarmos a tentativa.",
      });
    }

    if (providerOrder.normalizedStatus === "approved") {
      try {
        await processApprovedOrder({
          internalOrderId: orderId,
          providerOrder,
        });
      } catch (error) {
        console.error(
          "PIX aprovado, mas houve erro ao confirmar o pedido:",
          error
        );

        return res.status(502).json({
          message:
            "O pagamento PIX foi aprovado, mas não foi possível concluir a confirmação do pedido. Não realize outro pagamento; aguarde a regularização.",
          orderId,
          providerOrderId: providerOrder.orderId,
          paymentStatus: "confirmation_pending",
        });
      }
    }

    const savedPixOrder = await Order.findById(orderId);

    if (!savedPixOrder) {
      return res.status(404).json({
        message:
          "O pagamento foi processado, mas o pedido não pôde ser recuperado.",
      });
    }

    /*
     * =================================================
     * 5. RESPOSTA
     * =================================================
     */

    return res.status(201).json({
      message:
        "Pagamento Pix criado com sucesso.",

      orderId:
        savedPixOrder._id,

      providerOrderId:
        providerOrder.orderId,

      mercadoPagoOrderId:
        providerOrder.orderId,

      paymentId:
        providerOrder.payment?.id || null,

      status:
        providerOrder.status,

      statusDetail:
        providerOrder.statusDetail,

      stockReservation: {
        reserved:
          savedPixOrder.stockReservation?.reserved ||
          false,

        reservedAt:
          savedPixOrder.stockReservation?.reservedAt ||
          null,

        expiresAt:
          savedPixOrder.stockReservation?.expiresAt ||
          null,
      },

      pix: {
        qrCode:
          providerOrder.pix?.qrCode || null,

        qrCodeBase64:
          providerOrder.pix?.qrCodeBase64 || null,

        ticketUrl:
          providerOrder.pix?.ticketUrl || null,
      },
    });

  } catch (error) {
    console.error(
      "Erro ao criar pagamento Pix:",
      error.response?.data ||
      error.message ||
      error
    );

    return res.status(
      error.response?.status || 500
    ).json({
      message:
        "Erro ao criar pagamento Pix.",

      error:
        error.response?.data ||
        error.message ||
        null,
    });
  }
};

/*
 * =====================================================
 * CRIA PAGAMENTO POR CARTÃO
 * =====================================================
 */

export const createCardPayment = async (req, res) => {
  try {
    const { orderId } = req.params;

    const order = await Order.findById(orderId);

    if (!order) {
      return res.status(404).json({
        message: "Pedido não encontrado.",
      });
    }

    if (order.buyer.toString() !== req.user.id) {
      return res.status(403).json({
        message: "Você não pode pagar este pedido.",
      });
    }

    if (
      order.status !== "pending" ||
      order.paymentStatus !== "pending"
    ) {
      return res.status(400).json({
        message: "Este pedido não está disponível para pagamento.",
      });
    }

    if (
      order.payment?.providerOrderId ||
      order.payment?.mercadoPagoOrderId ||
      order.payment?.idempotencyKey
    ) {
      return res.status(409).json({
        message: "Este pedido já possui uma tentativa de pagamento associada.",
      });
    }

    const { payer, card } = req.body || {};

    if (
      typeof payer?.email !== "string" ||
      !payer.email.trim() ||
      typeof payer?.identification?.type !== "string" ||
      !payer.identification.type.trim() ||
      typeof payer?.identification?.number !== "string" ||
      !payer.identification.number.trim() ||
      typeof card?.token !== "string" ||
      !card.token.trim() ||
      typeof card?.paymentMethodId !== "string" ||
      !card.paymentMethodId.trim() ||
      typeof card?.paymentTypeId !== "string" ||
      !card.paymentTypeId.trim() ||
      !Number.isInteger(card?.installments) ||
      card.installments < 1
    ) {
      return res.status(400).json({
        message: "Dados do pagamento por cartão inválidos ou incompletos.",
      });
    }

    const idempotencyKey =
      paymentProvider.generateIdempotencyKey();

    const claimedOrder = await Order.findOneAndUpdate(
      {
        _id: orderId,
        status: "pending",
        paymentStatus: "pending",
        "payment.idempotencyKey": null,
        "payment.providerOrderId": null,
        "payment.mercadoPagoOrderId": null,
      },
      {
        $set: {
          "payment.idempotencyKey": idempotencyKey,
          "payment.paymentMethod": "card",
          "payment.attemptStatus": "preparing",
          "payment.attemptStartedAt": new Date(),
        },
      },
      {
        returnDocument: "after",
      }
    );

    if (!claimedOrder) {
      return res.status(409).json({
        message:
          "Este pedido já possui uma tentativa de pagamento em andamento.",
      });
    }
    try {
      await reserveOrderStock(orderId);
    } catch (error) {
      await Order.updateOne(
        {
          _id: orderId,
          "payment.idempotencyKey": idempotencyKey,
          "payment.attemptStatus": "preparing",
          "payment.providerOrderId": null,
          "payment.mercadoPagoOrderId": null,
        },
        {
          $set: {
            "payment.idempotencyKey": null,
            "payment.paymentMethod": null,
            "payment.attemptStatus": null,
            "payment.attemptStartedAt": null,
          },
        }
      );

      throw error;
    }

    const updatedOrder = await Order.findById(orderId);

    const submitAttemptResult = await Order.updateOne(
      {
        _id: orderId,
        "payment.idempotencyKey": idempotencyKey,
        "payment.attemptStatus": "preparing",
      },
      {
        $set: {
          "payment.attemptStatus": "submitted",
        },
      }
    );

    if (submitAttemptResult.matchedCount !== 1) {
      return res.status(409).json({
        message:
          "Não foi possível confirmar a tentativa de pagamento. Nenhuma cobrança foi enviada por esta requisição.",
      });
    }

    let providerOrder;

    try {
      providerOrder = await paymentProvider.createPayment({
        order: updatedOrder,
        payer,
        card,
        idempotencyKey,
        method: "card",
      });
    } catch (error) {
      // A requisição pode ter chegado ao Mercado Pago.
      // Preservamos a chave e a reserva até reconciliar o resultado.
      console.error(
        "Resultado da tentativa de cartão desconhecido:",
        JSON.stringify(
          error.response?.data || error.message,
          null,
          2
        )
      );

      return res.status(502).json({
        message:
          "Não foi possível confirmar o resultado do pagamento. Não tente pagar novamente este pedido até verificarmos a tentativa.",
      });
    }

    if (
      providerOrder.externalReference !==
      updatedOrder._id.toString()
    ) {
      return res.status(502).json({
        message:
          "A referência do pagamento retornado não corresponde ao pedido. A tentativa foi preservada para verificação.",
      });
    }

    const savePaymentResult = await Order.updateOne(
      {
        _id: orderId,
        "payment.idempotencyKey": idempotencyKey,
        "payment.attemptStatus": "submitted",
      },
      {
        $set: {
          "payment.providerOrderId": providerOrder.orderId,
          "payment.mercadoPagoOrderId": providerOrder.orderId,
          "payment.providerPaymentId": providerOrder.payment?.id || null,
          "payment.paymentId": providerOrder.payment?.id || null,
          "payment.paymentMethod": "card",
          "payment.attemptStatus": "resolved",
        },
      }
    );

    if (savePaymentResult.matchedCount !== 1) {
      console.error(
        "Não foi possível associar o pagamento ao pedido:",
        orderId,
        providerOrder.orderId
      );

      return res.status(502).json({
        message:
          "O pagamento foi enviado, mas não foi possível registrar seu resultado no pedido. Não tente pagar novamente até verificarmos a tentativa.",
      });
    }

    if (providerOrder.normalizedStatus === "approved") {
      await processApprovedOrder({
        internalOrderId: updatedOrder._id,
        providerOrder,
      });
    }

    const finalOrder = await Order.findById(orderId);

    const paymentFailed = [
      "failed",
      "cancelled",
    ].includes(providerOrder.normalizedStatus);

    return res.status(paymentFailed ? 200 : 201).json({
      message: paymentFailed
        ? "O pagamento por cartão não foi aprovado."
        : "Tentativa de pagamento por cartão registrada.",
      orderId: finalOrder._id,
      paymentStatus: finalOrder.paymentStatus,
      providerStatus: providerOrder.normalizedStatus,
      providerOrderId: providerOrder.orderId,
    });
  } catch (error) {
    console.error(
      "Erro ao iniciar pagamento por cartão:",
      error
    );

    return res.status(500).json({
      message: "Erro ao iniciar pagamento por cartão.",
    });
  }
};

export const getOrderPayment =
  async (req, res) => {
    try {
      const {
        orderId,
      } = req.params;

      let order =
        await Order.findById(
          orderId
        );

      if (!order) {
        return res.status(404).json({
          message:
            "Pedido não encontrado.",
        });
      }

      /*
       * Garante que somente
       * o comprador possa
       * consultar o pagamento.
       */
      if (
        order.buyer.toString() !==
        req.user.id
      ) {
        return res.status(403).json({
          message:
            "Você não tem permissão para acessar este pagamento.",
        });
      }

      const providerName =
        order.payment?.provider;

      const providerOrderId =
        order.payment
          ?.providerOrderId ||
        order.payment
          ?.mercadoPagoOrderId;

      if (
        !providerName ||
        !providerOrderId
      ) {
        if (
          order.payment?.attemptStatus ===
          "submitted"
        ) {
          return res.status(202).json({
            orderId: order._id,
            paymentStatus:
              order.paymentStatus,
            attemptStatus: "submitted",
            message:
              "A tentativa de pagamento foi enviada, mas seu resultado ainda não foi confirmado. Não inicie outro pagamento para este pedido.",
          });
        }

        return res.status(400).json({
          message:
            "Este pedido ainda não possui um pagamento associado.",
        });
      }

      const paymentProvider =
        getPaymentProviderByName(
          providerName
        );

      const providerOrder =
        await paymentProvider.getOrder(
          providerOrderId
        );

      /*
* ==========================
* RECONCILIA PAGAMENTO
* ==========================
*
* Caso o Mercado Pago já
* considere a Order paga,
* mas nosso banco ainda
* esteja pendente.
*/
      if (
        providerOrder.normalizedStatus ===
        "approved" &&
        order.paymentStatus !==
        "paid"
      ) {
        await processApprovedOrder({
          internalOrderId:
            order._id,
          providerOrder,
          notificationId:
            null,
        });

        order =
          await Order.findById(
            orderId
          );
      }

      return res.status(200).json({
        orderId:
          order._id,

        paymentStatus:
          order.paymentStatus,

        provider:
          providerName,

        providerOrderId:
          providerOrder.orderId,

        paymentId:
          providerOrder.payment
            ?.id ||
          null,

        status:
          providerOrder.status,

        statusDetail:
          providerOrder.statusDetail,

        pix: {
          qrCode:
            providerOrder.pix
              ?.qrCode ||
            null,

          qrCodeBase64:
            providerOrder.pix
              ?.qrCodeBase64 ||
            null,

          ticketUrl:
            providerOrder.pix
              ?.ticketUrl ||
            null,
        },

        stockReservation: {
          reserved:
            order.stockReservation
              ?.reserved ||
            false,

          reservedAt:
            order.stockReservation
              ?.reservedAt ||
            null,

          expiresAt:
            order.stockReservation
              ?.expiresAt ||
            null,
        },
      });

    } catch (error) {
      console.error(
        "Erro ao consultar pagamento:",
        error
      );

      return res.status(500).json({
        message:
          "Erro ao consultar pagamento.",
      });
    }
  };