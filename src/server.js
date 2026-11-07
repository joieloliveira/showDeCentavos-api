import "dotenv/config";

import { validateProductionSecrets } from "./config/productionSecurity.js";
validateProductionSecrets();

const { default: app } = await import("./app.js");
import conectarMongoDB from "./config/conexao.js";
import Bid from "./models/Bid.js";
import {
  startStockReservationJob,
} from "./jobs/stockReservationJob.js";

import {
  startAuctionScheduler,
} from "./services/AuctionSchedulerService.js";

const PORT = process.env.PORT || 3001;

const iniciarServidor = async () => {
  await conectarMongoDB();

  await Bid.createCollection();
  await Bid.createIndexes();

  startStockReservationJob();
  startAuctionScheduler();

  app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
  });
};

iniciarServidor();