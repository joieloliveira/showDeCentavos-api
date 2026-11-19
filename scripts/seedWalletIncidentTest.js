/**
 * Cria um incidente fictício persistente para testes HTTP no Insomnia.
 * Usa EXCLUSIVAMENTE WALLET_TEST_MONGODB_URI com database wallet_test_*.
 * Não altera saldo, ledger ou contas preexistentes. Não chama Mercado Pago.
 *
 * $env:WALLET_TEST_MONGODB_URI="mongodb://127.0.0.1:27018/wallet_test_pix?replicaSet=walletTestRS"
 * node scripts/seedWalletIncidentTest.js
 * node scripts/seedWalletIncidentTest.js --cleanup <incidentId>
 */
import "dotenv/config";
import mongoose from "mongoose";
import User from "../src/models/User.js";
import WalletDeposit from "../src/models/WalletDeposit.js";
import WalletPaymentIncident from "../src/models/WalletPaymentIncident.js";

const uri = process.env.WALLET_TEST_MONGODB_URI;
let dbName = "";
try { dbName = new URL(uri).pathname.slice(1); } catch { /* refuse unsafe URI */ }
if (!/^wallet_test_[a-z0-9_-]+$/i.test(dbName)) {
  console.error("Recusado: WALLET_TEST_MONGODB_URI deve apontar para um banco wallet_test_*.");
  process.exitCode = 1;
} else {
  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
    const [command, incidentId, extra] = process.argv.slice(2);
    if (command === "--cleanup" && !extra && mongoose.isObjectIdOrHexString(incidentId)) {
      const incident = await WalletPaymentIncident.findById(incidentId);
      if (!incident) throw new Error("Incidente de teste não encontrado.");
      const [user, deposit] = await Promise.all([
        User.findById(incident.user), WalletDeposit.findById(incident.deposit),
      ]);
      const valid = user?.email?.startsWith("wallet-incident-fixture-") &&
        user.email.endsWith("@example.invalid") &&
        deposit?.providerOrderId?.startsWith("FIXTURE-WALLET-INCIDENT-") &&
        String(deposit.user) === String(user._id) &&
        String(deposit._id) === String(incident.deposit) &&
        incident.providerOrderId === deposit.providerOrderId;
      if (!valid) throw new Error("Registro não pertence ao fixture; nenhuma exclusão realizada.");
      await WalletPaymentIncident.deleteOne({ _id: incident._id });
      await WalletDeposit.deleteOne({ _id: deposit._id });
      await User.deleteOne({ _id: user._id });
      console.log(JSON.stringify({ removedIncidentId: incidentId, database: dbName }));
    } else if (command === undefined) {
      await Promise.all([User.init(), WalletDeposit.init(), WalletPaymentIncident.init()]);
      const key = new mongoose.Types.ObjectId().toString();
      let user;
      let deposit;
      let incident;
      try {
        user = await User.create({
          name: "Wallet Incident Fixture", email: `wallet-incident-fixture-${key}@example.invalid`,
          role: "customer", wallet: { balanceCents: 0 },
        });
        deposit = await WalletDeposit.create({
          user: user._id, amountCents: 1000, status: "approved",
          provider: "mercadopago", providerOrderId: `FIXTURE-WALLET-INCIDENT-${key}`,
          processedAt: new Date(),
        });
        incident = await WalletPaymentIncident.create({
          deposit: deposit._id, user: user._id, provider: "mercadopago",
          providerOrderId: deposit.providerOrderId,
          providerStatus: "refunded", resolution: "review_required",
        });
      } catch (error) {
        if (incident) await WalletPaymentIncident.deleteOne({ _id: incident._id });
        if (deposit) await WalletDeposit.deleteOne({ _id: deposit._id });
        if (user) await User.deleteOne({ _id: user._id });
        throw error;
      }
      console.log(JSON.stringify({
        database: dbName, incidentId: String(incident._id),
        depositId: String(deposit._id), userId: String(user._id),
        amountCents: deposit.amountCents, walletBalanceCents: user.wallet.balanceCents,
        detailUrl: `http://localhost:3001/api/admin/wallet/incidents/${incident._id}`,
        cleanup: `node scripts/seedWalletIncidentTest.js --cleanup ${incident._id}`,
      }, null, 2));
    } else {
      throw new Error("Uso: node scripts/seedWalletIncidentTest.js [--cleanup <incidentId>]");
    }
  } catch (error) {
    console.error("Falha no fixture:", error.message);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}
