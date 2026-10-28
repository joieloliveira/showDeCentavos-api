import Order from "../models/Order.js";
import Product from "../models/Product.js";
import User from "../models/User.js";

import {
  MARKETPLACE_COMMISSION_PERCENT,
} from "../config/marketplace.js";


export const createOrder = async (req, res) => {
  try {
    const {
      items,
      shippingAddress,
    } = req.body;

    /*
     * ============================
     * ENDEREÇO
     * ============================
     */

    if (!shippingAddress) {
      return res.status(400).json({
        message: "O endereço de entrega é obrigatório.",
      });
    }

    const {
      recipientName,
      phone,
      zipCode,
      street,
      number,
      complement,
      neighborhood,
      city,
      state,
      country,
    } = shippingAddress;

    if (
      !recipientName ||
      !phone ||
      !zipCode ||
      !street ||
      !number ||
      !neighborhood ||
      !city ||
      !state
    ) {
      return res.status(400).json({
        message:
          "Preencha todos os dados obrigatórios do endereço.",
      });
    }

    /*
     * ============================
     * COMPRADOR
     * ============================
     */

    const buyer = await User.findById(
      req.user.id
    );

    if (!buyer) {
      return res.status(404).json({
        message: "Usuário não encontrado.",
      });
    }

    /*
     * ============================
     * ITEMS
     * ============================
     */

    if (
      !Array.isArray(items) ||
      items.length === 0
    ) {
      return res.status(400).json({
        message:
          "O pedido precisa ter pelo menos um produto.",
      });
    }

    const normalizedItems = [];

    let subtotal = 0;
    let platformFeeTotal = 0;
    let sellerTotal = 0;

    for (const item of items) {
      const {
        productId,
        quantity,
      } = item;

      if (!productId || !quantity) {
        return res.status(400).json({
          message:
            "productId e quantity são obrigatórios.",
        });
      }

      const numericQuantity =
        Number(quantity);

      if (
        !Number.isInteger(
          numericQuantity
        ) ||
        numericQuantity <= 0
      ) {
        return res.status(400).json({
          message:
            "A quantidade deve ser um número inteiro maior que zero.",
        });
      }

      /*
       * ============================
       * PRODUTO
       * ============================
       */

      const product =
        await Product.findOne({
          _id: productId,
          status: "active",
        });

      if (!product) {
        return res.status(404).json({
          message:
            `Produto não encontrado: ${productId}`,
        });
      }

      /*
       * IMPORTANTE:
       *
       * Agora verificamos o estoque
       * realmente disponível:
       *
       * stock - reservedStock
       */

      const availableStock =
        product.stock -
        (product.reservedStock || 0);

      if (
        availableStock <
        numericQuantity
      ) {
        return res.status(400).json({
          message:
            `Estoque disponível insuficiente para o produto ${product.name}.`,
          availableStock,
        });
      }

      /*
       * ============================
       * CÁLCULO DO ITEM
       * ============================
       */

      const itemTotal =
        Number(
          (
            product.price *
            numericQuantity
          ).toFixed(2)
        );

      const platformFeePercent =
        MARKETPLACE_COMMISSION_PERCENT;

      const platformFeeAmount =
        Number(
          (
            itemTotal *
            (
              platformFeePercent /
              100
            )
          ).toFixed(2)
        );

      const sellerAmount =
        Number(
          (
            itemTotal -
            platformFeeAmount
          ).toFixed(2)
        );

      subtotal += itemTotal;

      platformFeeTotal +=
        platformFeeAmount;

      sellerTotal +=
        sellerAmount;

      /*
       * ============================
       * SNAPSHOT DO ITEM
       * ============================
       */

      normalizedItems.push({
        product:
          product._id,

        seller:
          product.seller,

        name:
          product.name,

        image:
          product.coverImage?.url ||
          product.images?.[0]?.url ||
          null,

        quantity:
          numericQuantity,

        unitPrice:
          product.price,

        total:
          itemTotal,

        platformFeePercent,

        platformFeeAmount,

        sellerAmount,
      });
    }

    /*
     * ============================
     * ARREDONDAMENTOS
     * ============================
     */

    subtotal =
      Number(
        subtotal.toFixed(2)
      );

    platformFeeTotal =
      Number(
        platformFeeTotal.toFixed(2)
      );

    sellerTotal =
      Number(
        sellerTotal.toFixed(2)
      );

    /*
     * ============================
     * FRETE / DESCONTO
     * ============================
     */

    const shipping = 0;
    const discount = 0;

    const total =
      Number(
        (
          subtotal +
          shipping -
          discount
        ).toFixed(2)
      );

    /*
     * ============================
     * CRIA ORDER
     * ============================
     */

    const order =
      await Order.create({
        buyer:
          req.user.id,

        buyerSnapshot: {
          name:
            buyer.name,

          email:
            buyer.email,

          phone:
            buyer.phone ||
            phone,
        },

        shippingAddress: {
          recipientName,
          phone,
          zipCode,
          street,
          number,

          complement:
            complement ||
            null,

          neighborhood,
          city,
          state,

          country:
            country ||
            "BR",
        },

        items:
          normalizedItems,

        subtotal,
        shipping,
        discount,
        total,

        platformFeeTotal,
        sellerTotal,

        paymentStatus:
          "pending",

        status:
          "pending",
      });

    return res
      .status(201)
      .json({
        message:
          "Pedido criado com sucesso.",

        order,
      });

  } catch (error) {
    console.error(
      "Erro ao criar pedido:",
      error
    );

    return res.status(500).json({
      message:
        "Erro interno do servidor.",
    });
  }
};


export const listMyOrders = async (
  req,
  res
) => {
  try {
    const requestedPage =
      Number(
        req.query.page
      ) || 1;

    const requestedLimit =
      Number(
        req.query.limit
      ) || 10;

    const page =
      Math.max(
        requestedPage,
        1
      );

    const limit =
      Math.min(
        Math.max(
          requestedLimit,
          1
        ),
        50
      );

    const skip =
      (page - 1) *
      limit;

    const filter = {
      buyer:
        req.user.id,
    };

    const [
      orders,
      totalOrders,
    ] =
      await Promise.all([
        Order.find(
          filter
        )
          .sort({
            createdAt:
              -1,
          })
          .skip(
            skip
          )
          .limit(
            limit
          ),

        Order.countDocuments(
          filter
        ),
      ]);

    return res.status(200).json({
      orders,

      pagination: {
        totalOrders,

        page,

        limit,

        totalPages:
          Math.ceil(
            totalOrders /
            limit
          ),
      },
    });

  } catch (error) {
    console.error(
      "Erro ao listar pedidos:",
      error
    );

    return res.status(500).json({
      message:
        "Erro interno do servidor.",
    });
  }
};


export const getOrderById = async (
  req,
  res
) => {
  try {
    const {
      id,
    } = req.params;

    const order =
      await Order.findById(
        id
      )
        .populate(
          "buyer",
          "name email"
        )
        .populate(
          "items.seller",
          "name seller.storeName seller.storeSlug"
        );

    if (!order) {
      return res.status(404).json({
        message:
          "Pedido não encontrado.",
      });
    }

    const isBuyer =
      order.buyer._id
        .toString() ===
      req.user.id;

    const isAdmin =
      req.user.role ===
      "admin";

    if (
      !isBuyer &&
      !isAdmin
    ) {
      return res.status(403).json({
        message:
          "Você não tem permissão para visualizar este pedido.",
      });
    }

    return res.status(200).json({
      order,
    });

  } catch (error) {
    console.error(
      "Erro ao buscar pedido:",
      error
    );

    return res.status(500).json({
      message:
        "Erro interno do servidor.",
    });
  }
};


export const listSellerOrders = async (
  req,
  res
) => {
  try {
    const requestedPage =
      Number(
        req.query.page
      ) || 1;

    const requestedLimit =
      Number(
        req.query.limit
      ) || 10;

    const page =
      Math.max(
        requestedPage,
        1
      );

    const limit =
      Math.min(
        Math.max(
          requestedLimit,
          1
        ),
        50
      );

    const skip =
      (page - 1) *
      limit;

    const sellerId =
      req.user.id;

    const filter = {
      "items.seller":
        sellerId,
    };

    const [
      orders,
      totalOrders,
    ] =
      await Promise.all([
        Order.find(
          filter
        )
          .populate(
            "buyer",
            "name email"
          )
          .sort({
            createdAt:
              -1,
          })
          .skip(
            skip
          )
          .limit(
            limit
          ),

        Order.countDocuments(
          filter
        ),
      ]);

    /*
     * Aqui filtramos somente
     * os itens pertencentes
     * ao vendedor logado.
     */

    const sellerOrders =
      orders.map(
        (order) => {
          const sellerItems =
            order.items.filter(
              (item) =>
                item.seller
                  .toString() ===
                sellerId
            );

          /*
           * Valor bruto vendido.
           */

          const sellerGrossTotal =
            sellerItems.reduce(
              (
                total,
                item
              ) =>
                total +
                item.total,

              0
            );

          /*
           * Valor líquido destinado
           * ao vendedor após comissão.
           */

          const sellerNetTotal =
            sellerItems.reduce(
              (
                total,
                item
              ) =>
                total +
                item.sellerAmount,

              0
            );

          /*
           * Comissão da plataforma
           * referente aos itens desse
           * vendedor.
           */

          const platformFeeTotal =
            sellerItems.reduce(
              (
                total,
                item
              ) =>
                total +
                item.platformFeeAmount,

              0
            );

          return {
            id:
              order._id,

            buyer:
              order.buyer,

            items:
              sellerItems,

            sellerGrossTotal:
              Number(
                sellerGrossTotal
                  .toFixed(2)
              ),

            platformFeeTotal:
              Number(
                platformFeeTotal
                  .toFixed(2)
              ),

            sellerNetTotal:
              Number(
                sellerNetTotal
                  .toFixed(2)
              ),

            paymentStatus:
              order.paymentStatus,

            status:
              order.status,

            createdAt:
              order.createdAt,
          };
        }
      );

    return res.status(200).json({
      orders:
        sellerOrders,

      pagination: {
        totalOrders,

        page,

        limit,

        totalPages:
          Math.ceil(
            totalOrders /
            limit
          ),
      },
    });

  } catch (error) {
    console.error(
      "Erro ao listar pedidos do vendedor:",
      error
    );

    return res.status(500).json({
      message:
        "Erro interno do servidor.",
    });
  }
};

export const listAdminOrders = async (
  req,
  res
) => {
  try {
    const requestedPage =
      Number(
        req.query.page
      ) || 1;

    const requestedLimit =
      Number(
        req.query.limit
      ) || 10;

    const page =
      Math.max(
        requestedPage,
        1
      );

    const limit =
      Math.min(
        Math.max(
          requestedLimit,
          1
        ),
        50
      );

    const skip =
      (page - 1) *
      limit;

    /*
     * ============================
     * FILTROS
     * ============================
     */

    const filter = {};

    if (
      req.query.status
    ) {
      filter.status =
        req.query.status;
    }

    if (
      req.query.paymentStatus
    ) {
      filter.paymentStatus =
        req.query.paymentStatus;
    }

    const [
      orders,
      totalOrders,
    ] =
      await Promise.all([
        Order.find(
          filter
        )
          .populate(
            "buyer",
            "name email"
          )
          .populate(
            "items.seller",
            "name seller.storeName seller.storeSlug"
          )
          .sort({
            createdAt:
              -1,
          })
          .skip(
            skip
          )
          .limit(
            limit
          ),

        Order.countDocuments(
          filter
        ),
      ]);

    return res.status(200).json({
      orders,

      pagination: {
        totalOrders,

        page,

        limit,

        totalPages:
          Math.ceil(
            totalOrders /
            limit
          ),
      },
    });

  } catch (error) {
    console.error(
      "Erro ao listar pedidos administrativos:",
      error
    );

    return res.status(500).json({
      message:
        "Erro interno do servidor.",
    });
  }
};

export const updateSellerOrderStatus = async (
  req,
  res
) => {
  try {
    const {
      id,
    } = req.params;

    const {
      status,
    } = req.body;

    const allowedStatus = [
      "processing",
      "shipped",
      "delivered",
      "cancelled",
    ];

    if (
      !allowedStatus.includes(
        status
      )
    ) {
      return res.status(400).json({
        message:
          "Status inválido.",
      });
    }

    const order =
      await Order.findById(
        id
      );

    if (!order) {
      return res.status(404).json({
        message:
          "Pedido não encontrado.",
      });
    }

    const sellerId =
      req.user.id;

    const sellerItems =
      order.items.filter(
        (item) =>
          item.seller
            .toString() ===
          sellerId
      );

    if (
      sellerItems.length ===
      0
    ) {
      return res.status(403).json({
        message:
          "Você não possui produtos neste pedido.",
      });
    }

    /*
     * Atualiza somente os itens
     * pertencentes ao vendedor.
     */

    sellerItems.forEach(
      (item) => {
        item.status =
          status;
      }
    );

    /*
     * ============================
     * STATUS GLOBAL DA ORDER
     * ============================
     */

    const allDelivered =
      order.items.every(
        (item) =>
          item.status ===
          "delivered"
      );

    const allCancelled =
      order.items.every(
        (item) =>
          item.status ===
          "cancelled"
      );

    const anyShipped =
      order.items.some(
        (item) =>
          item.status ===
          "shipped"
      );

    const anyProcessing =
      order.items.some(
        (item) =>
          item.status ===
          "processing"
      );

    if (
      allDelivered
    ) {
      order.status =
        "delivered";

    } else if (
      allCancelled
    ) {
      order.status =
        "cancelled";

    } else if (
      anyShipped
    ) {
      order.status =
        "shipped";

    } else if (
      anyProcessing
    ) {
      order.status =
        "processing";

    } else {
      order.status =
        "pending";
    }

    await order.save();

    return res.status(200).json({
      message:
        "Status dos itens atualizado com sucesso.",

      order,
    });

  } catch (error) {
    console.error(
      "Erro ao atualizar status do pedido:",
      error
    );

    return res.status(500).json({
      message:
        "Erro interno do servidor.",
    });
  }
};

export const updateAdminOrderStatus = async (
  req,
  res
) => {
  try {
    const {
      id,
    } = req.params;

    const {
      status,
    } = req.body;

    const allowedStatus = [
      "processing",
      "shipped",
      "delivered",
      "cancelled",
    ];

    if (
      !allowedStatus.includes(
        status
      )
    ) {
      return res.status(400).json({
        message:
          "Status inválido.",
      });
    }

    const order =
      await Order.findById(
        id
      );

    if (!order) {
      return res.status(404).json({
        message:
          "Pedido não encontrado.",
      });
    }

    /*
     * O admin altera todos os
     * itens do pedido.
     */
    order.items.forEach(
      (item) => {
        item.status =
          status;
      }
    );

    order.status =
      status;

    await order.save();

    return res.status(200).json({
      message:
        "Status do pedido atualizado com sucesso.",

      order,
    });

  } catch (error) {
    console.error(
      "Erro ao atualizar status administrativo do pedido:",
      error
    );

    return res.status(500).json({
      message:
        "Erro interno do servidor.",
    });
  }
};