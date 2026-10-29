import WalletPaymentIncident from "../models/WalletPaymentIncident.js";

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
