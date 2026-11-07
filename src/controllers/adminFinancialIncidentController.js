import FinancialReconciliationIncident from "../models/FinancialReconciliationIncident.js";

const statuses = new Set(["pending", "investigating", "resolved"]);

export async function listAdminFinancialIncidents(req, res) {
  const rawPage = Number(req.query.page ?? 1);
  const rawLimit = Number(req.query.limit ?? 20);
  if (!Number.isSafeInteger(rawPage) || rawPage < 1 ||
      !Number.isSafeInteger(rawLimit) || rawLimit < 1 || rawLimit > 100) {
    return res.status(400).json({ message: "Paginação inválida." });
  }
  const status = req.query.status;
  if (status !== undefined && (typeof status !== "string" || !statuses.has(status))) {
    return res.status(400).json({ message: "Status inválido." });
  }
  const filter = status ? { status } : {};
  try {
    const [total, items] = await Promise.all([
      FinancialReconciliationIncident.countDocuments(filter),
      FinancialReconciliationIncident.find(filter)
        .select("order provider providerOrderId reason status firstSeenAt lastSeenAt occurrences createdAt")
        .sort({ lastSeenAt: -1, _id: -1 })
        .skip((rawPage - 1) * rawLimit)
        .limit(rawLimit)
        .lean()
    ]);
    res.set("Cache-Control", "no-store");
    return res.json({ page: rawPage, limit: rawLimit, total, items });
  } catch (error) {
    console.error("Erro ao consultar incidentes financeiros:", error);
    return res.status(500).json({ message: "Falha ao consultar incidentes financeiros." });
  }
}
