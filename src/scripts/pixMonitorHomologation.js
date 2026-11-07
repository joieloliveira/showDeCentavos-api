// Isolated local browser homologation. Never connect this server to a production database.
import mongoose from "mongoose";
import express from "express";
import cors from "cors";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { randomBytes } from "node:crypto";
import auctionRoutes from "../routes/auctionRoutes.js";
import authRoutes from "../routes/authRoutes.js";
import User from "../models/User.js";
import AuctionFulfillment from "../models/AuctionFulfillment.js";
import AuctionWinnerPayment from "../models/AuctionWinnerPayment.js";
import AuctionWinnerPixAttempt from "../models/AuctionWinnerPixAttempt.js";

const uri = process.env.WALLET_TEST_MONGODB_URI || "";
const safe = /^mongodb:\/\/127\.0\.0\.1:27018\/wallet_test_pix\?/.test(uri) &&
  /(?:\?|&)replicaSet=walletTestRS(?:&|$)/.test(uri) &&
  !/@|authSource=|directConnection=/.test(uri);
if (!safe || process.env.NODE_ENV === "production" || process.env.PIX_MONITOR_HOMOLOGATION !== "true") {
  console.error("Bloqueado: requer replicaSet local walletTestRS, NODE_ENV != production e PIX_MONITOR_HOMOLOGATION=true.");
  process.exit(1);
}
const dbName = `pix_monitor_browser_${process.pid}_${Date.now()}`;
const port = 3101;
const secret = randomBytes(32).toString("hex");
process.env.JWT_SECRET = secret;
process.env.AUCTION_BIDDING_ENABLED = "false";
process.env.AUCTION_ADDRESS_COLLECTION_ENABLED = "false";
process.env.AUCTION_DELIVERY_MANAGEMENT_ENABLED = "false";
let server;
let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    if (server) await new Promise(resolve => server.close(resolve));
    if (mongoose.connection.readyState === 1) await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    console.log("Banco temporário de homologação descartado.");
  } catch (error) {
    console.error("Falha na limpeza do banco temporário:", error);
    process.exitCode = 1;
  }
}
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => { shutdown().then(() => process.exit(process.exitCode || 0)); });
}
try {
  await mongoose.connect(uri, { dbName, serverSelectionTimeoutMS: 5000 });
  const password = randomBytes(12).toString("base64url");
  const email = "pix-homologation@example.test";
  const admin = await User.create({
    name: "Administrador de Homologação", email, role: "admin",
    isActive: true, password: await bcrypt.hash(password, 10)
  });
  const winner = new mongoose.Types.ObjectId();
  for (const [index, state, status, deliveryStatus] of [
    [1, "reserved", "pending", "not_started"],
    [2, "provider_confirmed", "paid", "preparing"],
    [3, "request_unknown", "pending", "not_started"],
    [4, "reconciliation_required", "pending", "not_started"]
  ]) {
    const auction = new mongoose.Types.ObjectId();
    const fulfillment = await AuctionFulfillment.create({
      auction, winner, product: new mongoose.Types.ObjectId(),
      winningPriceCents: index * 1000 + 250, wonAt: new Date(),
      paymentStatus: status, deliveryStatus,
      ...(index === 2 ? { addressSubmittedAt: new Date(), shippingAddress: {
        recipientName: "Destinatário Fictício", phone: "91999999999",
        zipCode: "66000000", street: "Rua de Homologação", number: "10",
        neighborhood: "Bairro Fictício", city: "Belém", state: "PA"
      } } : {})
    });
    const payment = await AuctionWinnerPayment.create({
      auction, fulfillment: fulfillment._id, winner,
      amountCents: index * 1000 + 250, status,
      providerOrderId: `HOMOLOGATION-ORDER-${index}`,
      ...(status === "paid" ? { processedAt: new Date(), providerPaymentId: `HOMOLOGATION-PIX-${index}` } : {})
    });
    await AuctionWinnerPixAttempt.create({
      auction, payment: payment._id, state,
      idempotencyKey: `homologation-${auction}`,
      ...(state === "provider_confirmed" ? { providerOrderId: `HOMOLOGATION-ORDER-${index}` } : {})
    });
  }
  const app = express();
  app.use(cors({ origin: "http://localhost:3000" }));
  app.use(express.json());
  app.use("/api/auth", authRoutes);
  app.use("/api/auctions", auctionRoutes);
  server = app.listen(port, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  console.log("\n=== MONITOR PIX: HOMOLOGAÇÃO ISOLADA ===");
  console.log("Banco temporário:", dbName);
  console.log("API local: http://127.0.0.1:3101/api");
  console.log("Login:", email);
  console.log("Senha temporária:", password);
  console.log("4 pagamentos fictícios persistidos; nenhum provedor de pagamento é chamado.");
  console.log("Use NEXT_PUBLIC_API_URL=http://127.0.0.1:3101/api no frontend de homologação.");
  console.log("Ao encerrar com Ctrl+C, o banco temporário será descartado.\n");
} catch (error) {
  console.error("Não foi possível iniciar a homologação:", error);
  await shutdown();
  process.exitCode = 1;
}
