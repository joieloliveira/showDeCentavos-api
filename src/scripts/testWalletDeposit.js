
import "dotenv/config";
import mongoose from "mongoose";

import { processApprovedWalletDeposit } from "../services/WalletDepositService.js";

const depositId = "6adfc3a0f94f888f99baf93d";

try {
  await mongoose.connect(process.env.MONGO_URI);

  console.log("MongoDB conectado.");

  const result = await processApprovedWalletDeposit({
    depositId,
  });

  console.log("Resultado do processamento:", result);
} catch (error) {
  console.error("Erro no teste de depósito:", error);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
