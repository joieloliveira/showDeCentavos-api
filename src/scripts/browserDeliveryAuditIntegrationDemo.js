// Local-only end-to-end fixture for the real administrative delivery endpoints.
// Never connects to the application's normal database or enables financial actions.
import crypto from "node:crypto";
import express from "express";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import auctionRoutes from "../routes/auctionRoutes.js";
import User from "../models/User.js";
import AuctionFulfillment from "../models/AuctionFulfillment.js";
import AuctionDeliveryAuditEvent from "../models/AuctionDeliveryAuditEvent.js";

const uri = process.env.WALLET_TEST_MONGODB_URI || "";
const safe = /^mongodb:\/\/127\.0\.0\.1:27018\/wallet_test_pix\?/.test(uri) &&
  /(?:\?|&)replicaSet=walletTestRS(?:&|$)/.test(uri) &&
  !/@|authSource=|directConnection=/.test(uri);
if (!safe) {
  console.error("Configure WALLET_TEST_MONGODB_URI para o replica set local walletTestRS na porta 27018.");
  process.exit(1);
}
process.env.JWT_SECRET = crypto.randomBytes(32).toString("hex");
process.env.AUCTION_BIDDING_ENABLED = "false";
process.env.AUCTION_DELIVERY_MANAGEMENT_ENABLED = "false";
process.env.AUCTION_ADDRESS_COLLECTION_ENABLED = "false";

const dbName = `auction_delivery_browser_${process.pid}_${Date.now()}`;
let server;
let connected = false;
let closing = false;
async function shutdown(code = 0) {
  if (closing) return;
  closing = true;
  try {
    if (server) await new Promise(resolve => server.close(resolve));
    if (connected) await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  } catch (error) {
    console.error("Falha ao limpar o banco temporário:", error);
    code = 1;
  }
  process.exitCode = code;
}
process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());

try {
  await mongoose.connect(uri, { dbName, serverSelectionTimeoutMS: 5000 });
  connected = true;
  const admin = await User.create({
    name: "Administrador de homologação",
    email: `delivery-browser-${Date.now()}@example.test`,
    role: "admin",
    isActive: true
  });
  const winner = new mongoose.Types.ObjectId();
  const product = new mongoose.Types.ObjectId();
  const auction = new mongoose.Types.ObjectId();
  const wonAt = new Date(Date.now() - 86400000);
  await AuctionFulfillment.create({
    auction, winner, product, winningPriceCents: 150, wonAt,
    paymentStatus: "paid", deliveryStatus: "delivered",
    addressSubmittedAt: wonAt,
    shippingAddress: {
      recipientName: "Vencedor fictício", phone: "91999999999", zipCode: "66000000",
      street: "Rua de teste", number: "10", neighborhood: "Centro",
      city: "Belém", state: "PA", country: "BR"
    }
  });
  await AuctionDeliveryAuditEvent.insertMany([
    { auction, actor: admin._id, fromStatus: "not_started", toStatus: "preparing", occurredAt: new Date(wonAt.getTime() + 3600000) },
    { auction, actor: admin._id, fromStatus: "preparing", toStatus: "shipped", occurredAt: new Date(wonAt.getTime() + 7200000) },
    { auction, actor: admin._id, fromStatus: "shipped", toStatus: "delivered", occurredAt: new Date(wonAt.getTime() + 10800000) }
  ]);
  const token = jwt.sign({ id: String(admin._id), role: "admin" }, process.env.JWT_SECRET, { expiresIn: "2h" });
  const app = express();
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    res.set("Cache-Control", "no-store");
    res.set("X-Content-Type-Options", "nosniff");
    const origin = req.headers.origin;
    if (origin && !["http://localhost:3000", "http://127.0.0.1:3000"].includes(origin)) {
      return res.status(403).json({ message: "Origem não permitida." });
    }
    if (origin) res.set("Access-Control-Allow-Origin", origin).set("Vary", "Origin");
    res.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
    res.set("Access-Control-Allow-Methods", "GET, OPTIONS");
    if (req.method === "OPTIONS") return res.sendStatus(204);
    if (req.method !== "GET") return res.sendStatus(405);
    next();
  });
  app.get("/demo/session", (_req, res) => res.json({ token, auctionId: String(auction), mode: "isolated-demo" }));
  app.use("/api/auctions", auctionRoutes);
  server = app.listen(3002, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  console.log("=== HOMOLOGAÇÃO REAL DA AUDITORIA ===");
  console.log("Banco temporário:", dbName);
  console.log("API isolada: http://127.0.0.1:3002");
  console.log("Interface: http://localhost:3000/admin/fulfillments/integration");
  console.log("Operações financeiras e alterações de entrega desativadas.");
  console.log("Pressione Ctrl+C para encerrar e excluir o banco temporário.");
} catch (error) {
  console.error("Falha ao iniciar homologação:", error);
  await shutdown(1);
}
