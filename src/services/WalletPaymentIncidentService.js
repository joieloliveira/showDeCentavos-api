import WalletPaymentIncident from "../models/WalletPaymentIncident.js";

const INCIDENT_STATUSES = new Set(["refunded", "charged_back"]);

export async function recordWalletPaymentIncident({ deposit, providerOrder }) {
  if (!deposit || deposit.provider !== "mercadopago" || !deposit._id || !deposit.user) {
    throw new Error("Depósito inválido para registro de incidente.");
  }
  if (!providerOrder || !INCIDENT_STATUSES.has(providerOrder.normalizedStatus) ||
      !providerOrder.orderId || providerOrder.orderId !== deposit.providerOrderId ||
      providerOrder.externalReference !== String(deposit._id)) {
    throw new Error("Evento de pagamento não corresponde ao depósito.");
  }
  try {
    return await WalletPaymentIncident.findOneAndUpdate(
    { deposit: deposit._id, providerStatus: providerOrder.normalizedStatus },
    {
      $setOnInsert: {
        user: deposit.user,
        provider: "mercadopago",
        providerOrderId: providerOrder.orderId,
        resolution: "review_required",
      },
      $set: { lastObservedAt: new Date() },
    },
    { upsert: true, returnDocument: "after", runValidators: true }
    );
  } catch (error) {
    // Two concurrent upserts can race on the unique deposit/status index.
    // A duplicate-key error means another request already recorded the incident.
    if (error?.code !== 11000) throw error;
    const existing = await WalletPaymentIncident.findOne({
      deposit: deposit._id,
      providerStatus: providerOrder.normalizedStatus,
    });
    if (!existing) throw error;
    return existing;
  }
}
