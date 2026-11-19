import { calculatePaymentDeadline, paymentWindowState } from "./auctionFulfillmentRules.js";

// Read-only payment preview. Never creates a provider charge or changes payment state.
export function auctionPaymentPreview({ auction, fulfillment, userId, now = new Date() }) {
  if (!auction || auction.status !== "finished" || !auction.winner ||
      String(auction.winner) !== String(userId)) {
    return { status: 404, message: "Arremate não encontrado para este vencedor." };
  }
  if (!auction.endsAt || !Number.isSafeInteger(auction.currentPriceCents) ||
      auction.currentPriceCents < 0) {
    return { status: 409, message: "Dados do arremate incompletos." };
  }
  if (fulfillment && (String(fulfillment.winner) !== String(userId) ||
      String(fulfillment.auction) !== String(auction._id) ||
      fulfillment.winningPriceCents !== auction.currentPriceCents)) {
    return { status: 409, message: "Dados do arremate inconsistentes." };
  }
  const paymentStatus = fulfillment?.paymentStatus ?? "not_started";
  const deadline = calculatePaymentDeadline(auction.endsAt);
  const windowStatus = paymentWindowState({ wonAt: auction.endsAt, paymentStatus, now });
  return {
    status: 200,
    data: {
      auctionId: String(auction._id),
      amountCents: auction.currentPriceCents,
      currency: "BRL",
      paymentStatus,
      paymentDeadline: deadline,
      paymentWindowStatus: windowStatus,
      checkoutEnabled: false,
      checkoutReason: "Pagamento de arremates ainda não habilitado."
    }
  };
}
