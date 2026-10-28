import {
  createPixOrder,
  createCardOrder,
  generateIdempotencyKey,
  getMercadoPagoOrder,
  searchMercadoPagoOrders,
} from "../MercadoPagoService.js";

const normalizeStatus = (status) => {
  switch (status) {
    case "processed":
      return "approved";

    case "pending":
    case "created":
    case "action_required":
      return "pending";

    case "failed":
      return "failed";

    case "canceled":
    case "cancelled":
    case "expired":
      return "cancelled";

    case "refunded":
      return "refunded";

    default:
      return "pending";
  }
};

const normalizeOrder = (mercadoPagoOrder) => {
  const payment =
    mercadoPagoOrder.transactions
      ?.payments?.[0];

  return {
    orderId: String(mercadoPagoOrder.id),

    normalizedStatus:
      normalizeStatus(
        mercadoPagoOrder.status
      ),

    status:
      mercadoPagoOrder.status,

    statusDetail:
      mercadoPagoOrder.status_detail || null,

    externalReference:
      mercadoPagoOrder.external_reference || null,

    payment: {
      id:
        payment?.id
          ? String(payment.id)
          : null,

      method:
        payment?.payment_method?.id || null,
    },

    pix: {
      qrCode:
        payment?.payment_method
          ?.qr_code || null,

      qrCodeBase64:
        payment?.payment_method
          ?.qr_code_base64 || null,

      ticketUrl:
        payment?.payment_method
          ?.ticket_url || null,
    },

    raw:
      mercadoPagoOrder,
  };
};

const MercadoPagoProvider = {
  name: "mercadopago",

  async createPayment({
    order,
    payer,
    card,
    idempotencyKey,
    method = "pix",
  }) {
    if (method === "pix") {
      return this.createPixPayment({
        order,
        payer,
        idempotencyKey,
      });
    }

    if (method === "card") {
      return this.createCardPayment({
        order,
        payer,
        card,
        idempotencyKey,
      });
    }

    throw new Error(
      `Método de pagamento não suportado pelo MercadoPagoProvider: ${method}`
    );
  },

  async createPixPayment({
    order,
    payer,
    idempotencyKey,
  }) {
    const mercadoPagoOrder =
      await createPixOrder({
        order,
        payer,
        idempotencyKey,
      });

    return normalizeOrder(
      mercadoPagoOrder
    );
  },

  async createCardPayment({
    order,
    payer,
    card,
    idempotencyKey,
  }) {
    const mercadoPagoOrder =
      await createCardOrder({
        order,
        payer,
        card,
        idempotencyKey,
      });

    return normalizeOrder(
      mercadoPagoOrder
    );
  },

  async getOrder(
    providerOrderId
  ) {
    const mercadoPagoOrder =
      await getMercadoPagoOrder(
        providerOrderId
      );

    return normalizeOrder(
      mercadoPagoOrder
    );
  },

  async searchOrders({
    externalReference,
    beginDate,
    endDate,
  }) {
    return searchMercadoPagoOrders({
      externalReference,
      beginDate,
      endDate,
    });
  },

  generateIdempotencyKey() {
    return generateIdempotencyKey();
  },
};

export default MercadoPagoProvider;