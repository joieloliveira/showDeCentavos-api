import cron from "node-cron";

import {
  reconcileExpiredReservations,
} from "../services/StockReservationService.js";

let isRunning = false;

export const startStockReservationJob = () => {
  cron.schedule("*/5 * * * *", async () => {
    if (isRunning) {
      console.log(
        "Reconciliação anterior ainda está em execução."
      );

      return;
    }

    isRunning = true;

    try {
      const result =
        await reconcileExpiredReservations();

      if (result.checked > 0) {
        console.log(
          "Reconciliação de estoque:",
          result
        );
      }
    } catch (error) {
      console.error(
        "Erro na reconciliação automática:",
        error
      );
    } finally {
      isRunning = false;
    }
  });

  console.log(
    "Job de reconciliação de estoque iniciado."
  );
};