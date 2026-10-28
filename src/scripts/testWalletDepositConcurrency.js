
import "dotenv/config";
import mongoose from "mongoose";
import { processApprovedWalletDeposit } from "../services/WalletDepositService.js";

const depositId = "6adfc3a0f94f888f99baf93d";

try {
    await mongoose.connect(process.env.MONGO_URI);

    console.log("MongoDB conectado.");
    console.log("Iniciando teste de concorrência...");

    const results = await Promise.allSettled([
        processApprovedWalletDeposit({ depositId }),
        processApprovedWalletDeposit({ depositId })
    ]);

    results.forEach((result, index) => {
        console.log(`Tentativa ${index + 1}:`, result);
    });

} catch (error) {
    console.error("Erro no teste de concorrência:", error);
    process.exitCode = 1;
} finally {
    await mongoose.disconnect();
}
