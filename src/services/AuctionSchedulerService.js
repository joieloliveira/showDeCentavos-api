
import Auction from "../models/Auction.js";

let schedulerInterval = null;
let isProcessing = false;

export const processAuctionSchedules = async () => {
  if (isProcessing) return;

  isProcessing = true;

  try {
    const now = new Date();

    // Ativar leilões cujo período de espera terminou
    const activatedResult = await Auction.updateMany(
      {
        status: "scheduled",
        waitingStartedAt: { $ne: null },
        startsAt: { $lte: now },
      },
      {
        $set: {
          status: "active",
        },
      }
    );

    if (activatedResult.modifiedCount > 0) {
      console.log(
        `${activatedResult.modifiedCount} leilão(ões) ativado(s) automaticamente.`
      );
    }

    // Encerrar leilões cujo cronômetro terminou
    const finishedResult = await Auction.updateMany(
      {
        status: "active",
        bidCount: { $gt: 0 },
        endsAt: { $lte: now },
        lastBidder: { $ne: null },
      },

      [
        {
          $set: {
            status: "finished",
            winner: "$lastBidder",
          },
        },
      ],
      { updatePipeline: true }
    );

    if (finishedResult.modifiedCount > 0) {
      console.log(
        `${finishedResult.modifiedCount} leilão(ões) encerrado(s) automaticamente.`
      );
    }
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
