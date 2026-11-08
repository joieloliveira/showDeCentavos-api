import mongoose from "mongoose";
import FinancialIncidentAudit from "../models/FinancialIncidentAudit.js";
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

export async function updateAdminFinancialIncident(req, res) {
  const { incidentId } = req.params;
  const { status, note } = req.body ?? {};
  if (!mongoose.isObjectIdOrHexString(incidentId)) {
    return res.status(400).json({ message: "ID inválido." });
  }
  if (!["investigating", "resolved"].includes(status) ||
      typeof note !== "string" || !note.trim() || note.trim().length > 2000) {
    return res.status(400).json({ message: "Status ou justificativa inválidos." });
  }

  const transitions = { pending: ["investigating"], investigating: ["resolved"] };
  let session;
  try {
    session = await mongoose.startSession();
    let updated;
    await session.withTransaction(async () => {
      const incident = await FinancialReconciliationIncident.findById(incidentId).session(session);
      if (!incident) {
        const error = new Error("Incidente não encontrado.");
        error.httpStatus = 404;
        throw error;
      }
      if (!transitions[incident.status]?.includes(status)) {
        const error = new Error("Transição de status não permitida.");
        error.httpStatus = 409;
        throw error;
      }
      const fromStatus = incident.status;
      incident.status = status;
      await incident.save({ session });
      await FinancialIncidentAudit.create([{
        incident: incident._id,
        actor: req.user.id,
        fromStatus,
        toStatus: status,
        note: note.trim(),
      }], { session });
      updated = incident;
    });
    res.set("Cache-Control", "no-store");
    return res.json({ incident: updated });
  } catch (error) {
    if (error.httpStatus) return res.status(error.httpStatus).json({ message: error.message });
    console.error("Erro ao atualizar incidente financeiro:", error);
    return res.status(500).json({ message: "Falha ao atualizar incidente financeiro." });
  } finally {
    if (session) await session.endSession();
  }
}

export async function listAdminFinancialIncidentAudit(req, res) {
  if (!mongoose.isObjectIdOrHexString(req.params.incidentId)) {
    return res.status(400).json({ message: "ID inválido." });
  }
  try {
    const incident = await FinancialReconciliationIncident.exists({ _id: req.params.incidentId });
    if (!incident) return res.status(404).json({ message: "Incidente não encontrado." });
    const history = await FinancialIncidentAudit.find({ incident: req.params.incidentId })
      .select("actor source fromStatus toStatus note createdAt")
      .sort({ createdAt: -1, _id: -1 }).limit(100).lean();
    res.set("Cache-Control", "no-store");
    return res.json({ items: history });
  } catch (error) {
    console.error("Erro ao consultar auditoria financeira:", error);
    return res.status(500).json({ message: "Falha ao consultar auditoria financeira." });
  }
}
