/**
 * Pure selection: never choose an order if the provider response is ambiguous.
 */
export const selectWalletPixOrderCandidate = (response, externalReference) => {
  const orders = Array.isArray(response)
    ? response
    : Array.isArray(response?.results)
      ? response.results
      : null;
  if (!orders) return { recovered: false, reason: "UNRECOGNIZED_SEARCH_RESPONSE" };

  const paging = response?.paging ?? response?.pagination ?? null;
  const total = paging?.total ?? response?.total ?? null;
  if (total !== null && (!Number.isSafeInteger(Number(total)) || Number(total) > orders.length)) {
    return { recovered: false, reason: "INCOMPLETE_SEARCH_RESULTS" };
  }

  const matching = orders.filter(
    (order) => String(order?.external_reference ?? "") === String(externalReference)
  );
  if (matching.length !== 1) {
    return {
      recovered: false,
      reason: matching.length > 1 ? "AMBIGUOUS_ORDERS" : "ORDER_NOT_FOUND",
    };
  }
  if (typeof matching[0]?.id !== "string" && typeof matching[0]?.id !== "number") {
    return { recovered: false, reason: "INVALID_ORDER_ID" };
  }
  const providerOrderId = String(matching[0].id);
  if (!providerOrderId.trim()) return { recovered: false, reason: "INVALID_ORDER_ID" };
  return { recovered: true, providerOrderId };
};
