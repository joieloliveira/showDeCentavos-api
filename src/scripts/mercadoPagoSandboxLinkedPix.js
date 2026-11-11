import "dotenv/config";
import mongoose from "mongoose";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import Order from "../models/Order.js";
import { createPixOrder } from "../services/MercadoPagoService.js";

const uri = process.env.MONGO_URI || "";
const parsed = uri ? new URL(uri) : null;
if (process.env.MERCADOPAGO_SANDBOX_MODE !== "true" ||
  !parsed || !["127.0.0.1", "localhost"].includes(parsed.hostname) ||
  parsed.port !== "27018" ||
  parsed.pathname !== "/showdecentavos_mp_sandbox" ||
  parsed.searchParams.get("replicaSet") !== "walletTestRS") {
  throw new Error("Bloqueado: conexão deve apontar para o banco isolado local.");
}
const token = process.env.MERCADOPAGO_ACCESS_TOKEN || "";
const fingerprint = process.env.MERCADOPAGO_SANDBOX_TOKEN_SHA256 || "";
if (!token || !/^[a-f0-9]{64}$/i.test(fingerprint) ||
  !timingSafeEqual(createHash("sha256").update(token).digest(), Buffer.from(fingerprint, "hex"))) {
  throw new Error("Bloqueado: impressão digital da credencial não corresponde.");
}
const orderId = process.argv.find((arg) => /^--order=/.test(arg))?.slice(8);
if (!orderId || !mongoose.isObjectIdOrHexString(orderId)) {
  throw new Error("Informe --order=<ObjectId do pedido sandbox>.");
}
const create = process.argv.includes("--create");
await mongoose.connect(uri);
try {
  const order = await Order.findById(orderId);
  if (!order || order.total !== 50 || order.paymentStatus !== "pending" ||
    !order.stockReservation?.reserved || order.items.length !== 1 ||
    order.items[0].quantity !== 1) {
    throw new Error("Pedido não encontrado ou não corresponde ao fixture pendente de R$ 50.");
  }
  const alreadyAttempted = Boolean(order.payment?.idempotencyKey ||
    order.payment?.providerOrderId || order.payment?.mercadoPagoOrderId ||
    order.payment?.attemptStatus);
  if (!create) {
    console.log({
      modo: "simulacao_local",
      banco: mongoose.connection.name,
      pedidoId: String(order._id),
      valorBRL: "50.00",
      estoqueReservado: true,
      tentativaAnterior: alreadyAttempted,
      chamadaExterna: false
    });
  } else {
    if (process.env.MERCADOPAGO_SANDBOX_ALLOW_CREATE !== "true") {
      throw new Error("Criação não autorizada no ambiente.");
    }
    if (alreadyAttempted) {
      throw new Error("Pedido já possui tentativa de cobrança; não criar outra.");
    }
    const idempotencyKey = randomUUID();
    const claimed = await Order.findOneAndUpdate({
      _id: order._id,
      paymentStatus: "pending",
      "stockReservation.reserved": true,
      "payment.idempotencyKey": null,
      "payment.providerOrderId": null,
      "payment.attemptStatus": null
    }, {
      $set: {
        "payment.idempotencyKey": idempotencyKey,
        "payment.attemptStatus": "preparing",
        "payment.attemptStartedAt": new Date(),
      }
    }, { returnDocument: "after" });
    if (!claimed) throw new Error("Tentativa já iniciada por outro processo; operação bloqueada.");

    // A tentativa fica registrada ANTES da chamada externa. Falhas ambíguas
    // exigem reconciliação, nunca criação de uma segunda cobrança.
    try {
      const providerOrder = await createPixOrder({
        order: claimed,
        payer: {},
        idempotencyKey,
        sandboxAuthorized: true,
      });
      if (!providerOrder?.id || providerOrder.external_reference !== String(claimed._id)) {
        throw new Error("Resposta do provedor sem ID ou com referência divergente.");
      }
      await Order.updateOne({
        _id: claimed._id,
        "payment.idempotencyKey": idempotencyKey,
      }, { $set: {
        "payment.providerOrderId": String(providerOrder.id),
        "payment.mercadoPagoOrderId": String(providerOrder.id),
        "payment.attemptStatus": "resolved",
      } });
      console.log({
        modo: "criacao_sandbox_vinculada",
        pedidoId: String(claimed._id),
        providerOrderId: String(providerOrder.id),
        status: providerOrder.status || null,
        cobrancaCriada: true,
      });
    } catch (error) {
      console.error("Tentativa registrada; NÃO repita --create. Reconcilie a cobrança pelo pedido.");
      throw error;
    }
  }
} finally {
  await mongoose.disconnect();
}
