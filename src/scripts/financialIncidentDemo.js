import "dotenv/config";
import mongoose from "mongoose";
import FinancialReconciliationIncident from "../models/FinancialReconciliationIncident.js";
import FinancialIncidentAudit from "../models/FinancialIncidentAudit.js";

// Run ONLY against the same local MongoDB used by the running development API.
// Usage: node src/scripts/financialIncidentDemo.js create --db=YOUR_DEV_DB
//        node src/scripts/financialIncidentDemo.js cleanup --db=YOUR_DEV_DB
const [action, dbArg] = process.argv.slice(2);
const expectedDb = dbArg?.startsWith("--db=") ? dbArg.slice(5) : null;
const uri = process.env.MONGO_URI;
const marker = "LOCAL-DEMO-FINANCIAL-INCIDENT";
const safeName = name => /^[a-zA-Z0-9_-]{3,64}$/.test(name) &&
  !/^(admin|local|config|production|prod|test)$/i.test(name) &&
  !/(prod|production)/i.test(name);
function assertSafe() {
  if (!["create", "cleanup"].includes(action) || !expectedDb || !safeName(expectedDb)) {
    throw new Error("Informe create ou cleanup e --db=NOME_DO_BANCO_LOCAL (não produção).");
  }
  if (process.env.NODE_ENV === "production" || !uri) throw new Error("MONGO_URI local obrigatório; produção bloqueada.");
  const parsed = new URL(uri);
  if (parsed.protocol !== "mongodb:" || !["127.0.0.1", "localhost"].includes(parsed.hostname) ||
      parsed.username || parsed.password || parsed.port === "" ||
      (parsed.pathname.slice(1) !== expectedDb) || parsed.searchParams.has("authSource")) {
    throw new Error("Use MONGO_URI=mongodb://127.0.0.1:PORTA/NOME_DO_BANCO_LOCAL sem autenticação, com --db correspondente.");
  }
}
async function main() {
  assertSafe();
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
  if (mongoose.connection.db.databaseName !== expectedDb) throw new Error("Banco conectado não corresponde ao banco solicitado.");
  if (action === "create") {
    const existing = await FinancialReconciliationIncident.findOne({ provider: "local_demo", providerOrderId: marker });
    if (existing) {
      console.log("Incidente fictício já existe:", String(existing._id));
      return;
    }
    const incident = await FinancialReconciliationIncident.create({
      order: new mongoose.Types.ObjectId(),
      provider: "local_demo",
      providerOrderId: marker,
      reason: "approved_amount_mismatch",
      status: "pending",
      occurrences: 1,
    });
    console.log("Incidente fictício criado:", String(incident._id));
    console.log("Abra /admin/financial/incidents e selecione Pendentes.");
  } else {
    const incidents = await FinancialReconciliationIncident.find({ provider: "local_demo", providerOrderId: marker }).select("_id").lean();
    const ids = incidents.map(item => item._id);
    if (ids.length) {
      await FinancialIncidentAudit.deleteMany({ incident: { $in: ids } });
      await FinancialReconciliationIncident.deleteMany({ _id: { $in: ids }, provider: "local_demo", providerOrderId: marker });
    }
    console.log("Dados fictícios removidos:", ids.length);
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; })
  .finally(async () => { await mongoose.disconnect(); });
