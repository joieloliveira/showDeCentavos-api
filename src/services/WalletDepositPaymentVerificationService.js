import MercadoPagoProvider from "./payments/MercadoPagoProvider.js";

/**
 * Confirma no provedor os dados de uma cobrança de recarga.
 * Esta função NÃO credita saldo. A confirmação e o crédito
 * devem ser ligados por uma transação MongoDB em etapa posterior.
 */
export const verifyWalletDepositPayment = async ({
  deposit,
  providerOrderId,
}) => {
  if (!deposit || deposit.provider !== "mercadopago") {
    throw new Error("Depósito Mercado Pago inválido.");
  }

  if (
    !Number.isSafeInteger(deposit.amountCents) ||
    deposit.amountCents <= 0
  ) {
    throw new Error("Valor do depósito inválido.");
  }

  if (
    typeof providerOrderId !== "string" ||
    !providerOrderId.trim()
  ) {
    throw new Error("Identificador da cobrança ausente.");
  }

  const providerOrder = await MercadoPagoProvider.getOrder(providerOrderId);

  if (
    providerOrder.orderId !== providerOrderId ||
    providerOrder.externalReference !== String(deposit._id)
  ) {
    throw new Error("Cobrança não corresponde ao depósito.");
  }

  if (providerOrder.normalizedStatus !== "approved") {
    return { approved: false, status: providerOrder.normalizedStatus };
  }

  // O Mercado Pago devolve total_amount como string decimal.
  // Convertê-lo a centavos evita comparação de valores float.
  const totalAmount = providerOrder.raw?.total_amount;
  const match = /^(\\d+)(?:\\.(\\d{1,2}))?$/.exec(String(totalAmount ?? ""));
  if (!match) {
    throw new Error("Valor da cobrança ausente ou inválido.");
  }

  const providerAmountCents =
    Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));

  if (
    !Number.isSafeInteger(providerAmountCents) ||
    providerAmountCents !== deposit.amountCents
  ) {
    throw new Error("Valor pago diverge do valor do depósito.");
  }

  const providerPaymentId = providerOrder.payment?.id;
  if (!providerPaymentId) {
    throw new Error("Pagamento aprovado sem identificador de transação.");
  }

  if (
    deposit.providerPaymentId &&
    deposit.providerPaymentId !== providerPaymentId
  ) {
    throw new Error("Pagamento diverge do identificador já registrado.");
  }

  return {
    approved: true,
    providerOrderId: providerOrder.orderId,
    providerPaymentId,
    amountCents: providerAmountCents,
  };
};
