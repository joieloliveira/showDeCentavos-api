// Pure authorization policy. Route must also enforce ownership in MongoDB queries.
export function addressWriteDecision({ featureEnabled, authenticatedUserId, auction, fulfillment }) {
  if (!featureEnabled) return { status: 503, message: "Cadastro de endereço de arremate ainda não habilitado." };
  if (!authenticatedUserId) return { status: 401, message: "Autenticação necessária." };
  if (!auction || auction.status !== "finished" || String(auction.winner) !== String(authenticatedUserId)) {
    return { status: 404, message: "Vitória não encontrada." };
  }
  if (fulfillment && String(fulfillment.winner) !== String(authenticatedUserId)) {
    return { status: 403, message: "Arremate indisponível." };
  }
  if (fulfillment && fulfillment.deliveryStatus !== "not_started") {
    return { status: 409, message: "Endereço bloqueado após início da entrega." };
  }
  return { status: 200, message: "Permitido." };
}
