import WalletDeposit from "../models/WalletDeposit.js";
import MercadoPagoProvider from "./payments/MercadoPagoProvider.js";

/**
 * Busca apenas cobranças já existentes. Nunca emite novo PIX.
 * Falha de forma conservadora diante de resposta ambígua do provedor.
 */
export const recoverWalletPixOrder = async (deposit) => {
  if (!deposit || deposit.provider !== "mercadopago") {
    throw new Error("Depósito inválido para recuperação.");
  }
  if (deposit.providerOrderId) return deposit.providerOrderId;

  const start = new Date(deposit.createdAt);
  if (Number.isNaN(start.getTime())) throw new Error("Data do depósito inválida.");
  const beginDate = new Date(start.getTime() - 5 * 60 * 1000).toISOString();
  const endDate = new Date().toISOString();
  const response = await MercadoPagoProvider.searchOrders({
    externalReference: String(deposit._id),
    beginDate,
    endDate,
  });

  // A estrutura da resposta deve ser validada em integração antes de ativar
  // formatos adicionais. Não escolhemos uma cobrança arbitrariamente.
  const orders = Array.isArray(response)
    ? response
    : Array.isArray(response?.results)
      ? response.results
      : null;
  if (!orders) return { recovered: false, reason: "UNRECOGNIZED_SEARCH_RESPONSE" };

  const matching = orders.filter(
    (order) => String(order?.external_reference ?? "") === String(deposit._id)
  );
  if (matching.length !== 1 || !matching[0]?.id) {
    return {
      recovered: false,
      reason: matching.length > 1 ? "AMBIGUOUS_ORDERS" : "ORDER_NOT_FOUND",
    };
  }

  const providerOrderId = String(matching[0].id);
  const confirmed = await MercadoPagoProvider.getOrder(providerOrderId);
  if (
    confirmed.orderId !== providerOrderId ||
    confirmed.externalReference !== String(deposit._id) ||
    confirmed.payment?.method !== "pix"
  ) throw new Error("Cobrança recuperada não corresponde à recarga PIX.");

  const amount = String(confirmed.raw?.total_amount ?? "");
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(amount);
  const cents = match
    ? Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"))
    : null;
  if (!Number.isSafeInteger(cents) || cents !== deposit.amountCents) {
    throw new Error("Valor da cobrança recuperada não corresponde ao depósito.");
  }

  const updated = await WalletDeposit.findOneAndUpdate(
    {
      _id: deposit._id,
      provider: "mercadopago",
      $or: [{ providerOrderId: null }, { providerOrderId }],
    },
    { $set: { providerOrderId, chargeStatus: "resolved" } },
    { returnDocument: "after" }
  );
  if (!updated) throw new Error("Depósito já vinculado a outra cobrança.");
  return { recovered: true, providerOrderId };
};
