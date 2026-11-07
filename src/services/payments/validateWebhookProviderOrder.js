// Validate the provider lookup result against the signed notification ID.
// A missing or mismatched result must be retried; never credit or release funds.
export function validateWebhookProviderOrder(providerOrder, notificationOrderId) {
  if (!providerOrder || !providerOrder.orderId ||
      String(providerOrder.orderId) !== String(notificationOrderId)) {
    return false;
  }
  return true;
}
