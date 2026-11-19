import AuctionAuditEvent from "../models/AuctionAuditEvent.js";
export async function recordAuctionAuditEvent(auction, eventType, occurredAt, source, actor = null) {
  try {
    await AuctionAuditEvent.updateOne(
      { auction, eventType },
      { $setOnInsert: { auction, eventType, occurredAt, source, actor } },
      { upsert: true }
    );
    return true;
  } catch (error) {
    console.error("Falha ao registrar evento de leilão:", eventType, String(auction), error);
    return false;
  }
}
