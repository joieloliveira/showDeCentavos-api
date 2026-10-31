import mongoose from "mongoose";
import WalletPaymentIncident from "../models/WalletPaymentIncident.js";
import WalletDeposit from "../models/WalletDeposit.js";
import User from "../models/User.js";

const statuses = new Set(["refunded", "charged_back"]);
const resolutions = new Set(["review_required", "resolved"]);

export const listAdminWalletIncidents = async (req, res) => {
  try {
    const page = Number(req.query.page ?? 1);
    const limit = Number(req.query.limit ?? 20);
    if (!Number.isSafeInteger(page) || page < 1 ||
        !Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      return res.status(400).json({ message: "Paginação inválida." });
    }
    const { providerStatus, resolution } = req.query;
    if ((providerStatus !== undefined && !statuses.has(providerStatus)) ||
        (resolution !== undefined && !resolutions.has(resolution))) {
      return res.status(400).json({ message: "Filtro de incidente inválido." });
    }
    const filter = {};
    if (providerStatus) filter.providerStatus = providerStatus;
    if (resolution) filter.resolution = resolution;

    const [total, incidents] = await Promise.all([
      WalletPaymentIncident.countDocuments(filter),
      WalletPaymentIncident.find(filter)
        .select("deposit user provider providerOrderId providerStatus resolution lastObservedAt createdAt updatedAt")
        .sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
    ]);
    return res.status(200).json({
      incidents,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (error) {
    console.error("Erro ao consultar incidentes da carteira:", error.message);
    return res.status(500).json({ message: "Erro ao consultar incidentes financeiros." });
  }
};

export const getAdminWalletIncident = async (req, res) => {
  try {
    const { incidentId } = req.params;
    if (!mongoose.isObjectIdOrHexString(incidentId)) {
      return res.status(400).json({ message: "Identificador do incidente inválido." });
    }

    const incident = await WalletPaymentIncident.findById(incidentId)
      .select("deposit user provider providerOrderId providerStatus resolution lastObservedAt createdAt updatedAt")
      .lean();
    if (!incident) {
      return res.status(404).json({ message: "Incidente não encontrado." });
    }

    const [deposit, user] = await Promise.all([
      WalletDeposit.findById(incident.deposit)
        .select("user amountCents status provider providerOrderId providerPaymentId processedAt createdAt")
        .lean(),
      User.findById(incident.user)
        .select("name email isActive")
        .lean(),
    ]);

    // Never expose another account's deposit when legacy data is inconsistent.
    const linkedDeposit = deposit &&
      String(deposit.user) === String(incident.user) &&
      deposit.provider === incident.provider &&
      deposit.providerOrderId === incident.providerOrderId
      ? {
          id: deposit._id,
          amountCents: deposit.amountCents,
          status: deposit.status,
          provider: deposit.provider,
          providerOrderId: deposit.providerOrderId,
          providerPaymentId: deposit.providerPaymentId,
          processedAt: deposit.processedAt,
          createdAt: deposit.createdAt,
        }
      : null;

    return res.status(200).json({
      incident,
      deposit: linkedDeposit,
      user: user ? { id: user._id, name: user.name, email: user.email, isActive: user.isActive } : null,
    });
  } catch (error) {
    console.error("Erro ao consultar detalhes de incidente:", error.message);
    return res.status(500).json({ message: "Erro ao consultar incidente financeiro." });
  }
};
