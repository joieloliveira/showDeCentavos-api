import Auction from "../models/Auction.js";
import AuctionFulfillment from "../models/AuctionFulfillment.js";
import WalletPaymentIncident from "../models/WalletPaymentIncident.js";

export async function getAuctionOperationsSummary(req, res) {
  try {
    const overdueCutoff = new Date(Date.now() - 48 * 60 * 60 * 1000);
    const [auctionStatuses, paymentStatuses, deliveryStatuses, incidentsRequiringReview, overduePayments, readyForPreparation, awaitingAddress, preparingDeliveries, shippedDeliveries] = await Promise.all([
      Auction.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
      AuctionFulfillment.aggregate([{ $group: { _id: "$paymentStatus", count: { $sum: 1 } } }]),
      AuctionFulfillment.aggregate([{ $group: { _id: "$deliveryStatus", count: { $sum: 1 } } }]),
      WalletPaymentIncident.countDocuments({ resolution: "review_required" }),
      AuctionFulfillment.countDocuments({ paymentStatus: { $in: ["not_started", "pending", "failed"] }, wonAt: { $lt: overdueCutoff } }),
      AuctionFulfillment.countDocuments({ paymentStatus: "paid", deliveryStatus: "not_started", addressSubmittedAt: { $ne: null } }),
      AuctionFulfillment.countDocuments({ paymentStatus: "paid", deliveryStatus: "not_started", addressSubmittedAt: null }),
      AuctionFulfillment.countDocuments({ deliveryStatus: "preparing" }),
      AuctionFulfillment.countDocuments({ deliveryStatus: "shipped" })
    ]);
    const counts = (rows, keys) => Object.fromEntries(keys.map(key => [key, rows.find(row => row._id === key)?.count || 0]));
    res.set("Cache-Control", "no-store");
    return res.json({
      auctions: counts(auctionStatuses, ["scheduled", "active", "finished", "cancelled"]),
      payments: counts(paymentStatuses, ["not_started", "pending", "paid", "failed", "refunded", "cancelled"]),
      deliveries: counts(deliveryStatuses, ["not_started", "preparing", "shipped", "delivered", "cancelled"]),
      incidentsRequiringReview,
      fulfillmentAlerts: { overduePayments, readyForPreparation, awaitingAddress, preparingDeliveries, shippedDeliveries }
    });
  } catch (error) {
    console.error("Erro ao consultar indicadores operacionais:", error);
    return res.status(500).json({ message: "Não foi possível consultar os indicadores." });
  }
}
