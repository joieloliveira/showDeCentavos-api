
import Auction from "../models/Auction.js";
import { publishAuctionEvent } from "./AuctionEventsService.js";

let schedulerInterval = null;
let isProcessing = false;

export const processAuctionSchedules = async () => {
  if (isProcessing) return;

  isProcessing = true;

  try {
    const now = new Date();

    // Conditional per-auction updates ensure only the process that changes
    // the state broadcasts the transition (also safe with multiple workers).
    const scheduled = await Auction.find({
      status: "scheduled", waitingStartedAt: { $ne: null }, startsAt: { $lte: now },
    }).select("_id").lean();
    let activated = 0;
    for (const item of scheduled) {
      const auction = await Auction.findOneAndUpdate(
        { _id: item._id, status: "scheduled", waitingStartedAt: { $ne: null }, startsAt: { $lte: now } },
        { $set: { status: "active" } },
        { returnDocument: "after" }
      );
      if (!auction) continue;
      activated++;
      publishAuctionEvent(auction._id, {
        status: auction.status, currentPriceCents: auction.currentPriceCents,
        bidCount: auction.bidCount, startsAt: auction.startsAt, endsAt: auction.endsAt,
      });
    }
    if (activated) console.log(`${activated} leilão(ões) ativado(s) automaticamente.`);

    const expiring = await Auction.find({
      status: "active", bidCount: { $gt: 0 }, endsAt: { $lte: now },
      lastBidder: { $ne: null },
    }).select("_id").lean();
    let finished = 0;
    for (const item of expiring) {
      const auction = await Auction.findOneAndUpdate(
        { _id: item._id, status: "active", bidCount: { $gt: 0 },
          endsAt: { $lte: now }, lastBidder: { $ne: null } },
        [{ $set: { status: "finished", winner: "$lastBidder" } }],
        { returnDocument: "after", updatePipeline: true }
      );
      if (!auction) continue;
      finished++;
      publishAuctionEvent(auction._id, {
        status: auction.status, currentPriceCents: auction.currentPriceCents,
        bidCount: auction.bidCount, startsAt: auction.startsAt, endsAt: auction.endsAt,
      });
    }
    if (finished) console.log(`${finished} leilão(ões) encerrado(s) automaticamente.`);
  } catch (error) {
    console.error("Erro ao processar agendamento de leilões:", error);
  } finally {
    isProcessing = false;
  }
};

export const startAuctionScheduler = () => {
  if (schedulerInterval) return;

  processAuctionSchedules();

  schedulerInterval = setInterval(() => {
    processAuctionSchedules();
  }, 1000);

  console.log("Scheduler de leilões iniciado.");
};

export const stopAuctionScheduler = () => {
  if (!schedulerInterval) return;

  clearInterval(schedulerInterval);
  schedulerInterval = null;
};
