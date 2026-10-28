import {
  reconcileExpiredReservations,
} from "../services/StockReservationService.js";
import Order from "../models/Order.js";
import Product from "../models/Product.js";
import User from "../models/User.js";

export const reconcileStockReservations = async (
  req,
  res
) => {
  try {
    const result =
      await reconcileExpiredReservations();

    return res.status(200).json({
      message:
        "Reconciliação executada com sucesso.",
      ...result,
    });
  } catch (error) {
    console.error(
      "Erro na reconciliação:",
      error
    );

    return res.status(500).json({
      message:
        "Erro ao reconciliar reservas.",
    });
  }
};

export const getAdminDashboard = async (
  req,
  res
) => {
  try {
    const [
      totalOrders,
      paidOrders,
      pendingOrders,
      revenueResult,
      totalProducts,
      activeProducts,
      outOfStockProducts,
      reservedStockResult,
      totalUsers,
      totalCustomers,
      totalSellers,
      activeSellers,
      recentOrders,
    ] = await Promise.all([
      /*
       * ============================
       * PEDIDOS
       * ============================
       */

      Order.countDocuments(),

      Order.countDocuments({
        paymentStatus: "paid",
      }),

      Order.countDocuments({
        status: "pending",
      }),

      /*
       * Faturamento considera apenas
       * pedidos com pagamento aprovado.
       */
      Order.aggregate([
        {
          $match: {
            paymentStatus: "paid",
          },
        },
        {
          $group: {
            _id: null,

            total: {
              $sum: "$total",
            },
          },
        },
      ]),

      /*
       * ============================
       * PRODUTOS
       * ============================
       */

      Product.countDocuments(),

      Product.countDocuments({
        status: "active",
      }),

      Product.countDocuments({
        status: "out_of_stock",
      }),

      /*
       * Quantidade total de unidades
       * atualmente reservadas.
       */
      Product.aggregate([
        {
          $group: {
            _id: null,

            total: {
              $sum: "$reservedStock",
            },
          },
        },
      ]),

      User.countDocuments(),

      User.countDocuments({
        role: "customer",
      }),

      User.countDocuments({
        role: "seller",
      }),

      User.countDocuments({
        role: "seller",
        isActive: true,
        "seller.isActive": true,
      }),

      /*
       * ============================
       * PEDIDOS RECENTES
       * ============================
       */

      Order.find()
        .populate(
          "buyer",
          "name email"
        )
        .sort({
          createdAt: -1,
        })
        .limit(5),
    ]);

    const revenue =
      revenueResult.length > 0
        ? revenueResult[0].total
        : 0;

    const reservedStock =
      reservedStockResult.length > 0
        ? reservedStockResult[0].total
        : 0;

    return res.status(200).json({
      orders: {
        total:
          totalOrders,

        paid:
          paidOrders,

        pending:
          pendingOrders,

        revenue:
          Number(
            revenue.toFixed(2)
          ),
      },

      products: {
        total: totalProducts,
        active: activeProducts,
        outOfStock: outOfStockProducts,
        reservedStock: reservedStock,
      },

      users: {
        total: totalUsers,
        customers: totalCustomers,
        sellers: totalSellers,
        activeSellers: activeSellers,
      },

      recentOrders,

      recentOrders,
    });

  } catch (error) {
    console.error(
      "Erro ao carregar dashboard administrativo:",
      error
    );

    return res.status(500).json({
      message:
        "Erro ao carregar dashboard administrativo.",
    });
  }
};

export const getAdminFinancial = async (req, res) => {
  try {
    const [
      paidSummary,
      refundedSummary,
      paidOrders,
      refundedOrders,
      pendingPayments,
      failedPayments,
      cancelledPayments,
      recentPaidOrders,
    ] = await Promise.all([
      Order.aggregate([
        {
          $match: {
            paymentStatus: "paid",
          },
        },
        {
          $group: {
            _id: null,
            grossRevenue: {
              $sum: "$total",
            },
            subtotal: {
              $sum: "$subtotal",
            },
            shipping: {
              $sum: "$shipping",
            },
            discounts: {
              $sum: "$discount",
            },
            platformRevenue: {
              $sum: "$platformFeeTotal",
            },
            sellerRevenue: {
              $sum: "$sellerTotal",
            },
          },
        },
      ]),

      Order.aggregate([
        {
          $match: {
            paymentStatus: "refunded",
          },
        },
        {
          $group: {
            _id: null,
            total: {
              $sum: "$total",
            },
          },
        },
      ]),

      Order.countDocuments({
        paymentStatus: "paid",
      }),

      Order.countDocuments({
        paymentStatus: "refunded",
      }),

      Order.countDocuments({
        paymentStatus: "pending",
      }),

      Order.countDocuments({
        paymentStatus: "failed",
      }),

      Order.countDocuments({
        paymentStatus: "cancelled",
      }),

      Order.find({
        paymentStatus: "paid",
      })
        .populate("buyer", "name email")
        .sort({
          createdAt: -1,
        })
        .limit(10),
    ]);

    const paid = paidSummary[0] || {
      grossRevenue: 0,
      subtotal: 0,
      shipping: 0,
      discounts: 0,
      platformRevenue: 0,
      sellerRevenue: 0,
    };

    const refunded =
      refundedSummary.length > 0
        ? refundedSummary[0].total
        : 0;

    return res.status(200).json({
      summary: {
        grossRevenue: Number(
          paid.grossRevenue.toFixed(2)
        ),

        subtotal: Number(
          paid.subtotal.toFixed(2)
        ),

        shipping: Number(
          paid.shipping.toFixed(2)
        ),

        discounts: Number(
          paid.discounts.toFixed(2)
        ),

        platformRevenue: Number(
          paid.platformRevenue.toFixed(2)
        ),

        sellerRevenue: Number(
          paid.sellerRevenue.toFixed(2)
        ),

        refunded: Number(
          refunded.toFixed(2)
        ),
      },

      payments: {
        paid: paidOrders,
        pending: pendingPayments,
        failed: failedPayments,
        refunded: refundedOrders,
        cancelled: cancelledPayments,
      },

      recentPaidOrders,
    });
  } catch (error) {
    console.error(
      "Erro ao carregar financeiro administrativo:",
      error
    );

    return res.status(500).json({
      message:
        "Erro ao carregar financeiro administrativo.",
    });
  }
};