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
  return WalletPaymentIncident.findOneAndUpdate(
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
}
