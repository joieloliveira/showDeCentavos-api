import "dotenv/config";
import mongoose from "mongoose";
import { createHash, timingSafeEqual } from "node:crypto";
import Product from "../models/Product.js";
import Order from "../models/Order.js";

// Fixture local: não chama o Mercado Pago nem altera usuários reais.
// Só aceita o banco exclusivo de homologação no replica set de testes.
const uri = process.env.MONGO_URI || "";
const parsed = uri ? new URL(uri) : null;
if (
  process.env.MERCADOPAGO_SANDBOX_MODE !== "true" ||
  !parsed ||
  !["127.0.0.1", "localhost"].includes(parsed.hostname) ||
  parsed.port !== "27018" ||
  parsed.pathname !== "/showdecentavos_mp_sandbox" ||
  parsed.searchParams.get("replicaSet") !== "walletTestRS"
) {
  throw new Error("Bloqueado: use exclusivamente o MongoDB sandbox local na porta 27018.");
}

const token = process.env.MERCADOPAGO_ACCESS_TOKEN || "";
const fingerprint = process.env.MERCADOPAGO_SANDBOX_TOKEN_SHA256 || "";
if (!token || !/^[a-f0-9]{64}$/i.test(fingerprint) ||
  !timingSafeEqual(createHash("sha256").update(token).digest(), Buffer.from(fingerprint, "hex"))) {
  throw new Error("Bloqueado: token de homologação não corresponde à impressão digital.");
}

await mongoose.connect(uri);
try {
  if (mongoose.connection.name !== "showdecentavos_mp_sandbox") {
    throw new Error("Banco conectado não corresponde ao sandbox.");
  }

  const buyerId = new mongoose.Types.ObjectId();
  const sellerId = new mongoose.Types.ObjectId();
  const productId = new mongoose.Types.ObjectId();
  const orderId = new mongoose.Types.ObjectId();

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      await Product.create([{
        _id: productId,
        seller: sellerId,
        name: "Produto fictício homologação PIX",
        slug: `mp-sandbox-${productId.toString()}`,
        description: "Somente teste de integração; não é um produto comercial.",
        price: 50,
        stock: 1,
        reservedStock: 1,
        sales: 0,
        status: "draft",
      }], { session });

      await Order.create([{
        _id: orderId,
        buyer: buyerId,
        buyerSnapshot: { name: "Comprador Teste", email: "test_payer@example.com" },
        shippingAddress: {
          recipientName: "Comprador Teste",
          phone: "00000000000",
          zipCode: "00000000",
          street: "Rua de Homologação",
          number: "0",
          neighborhood: "Teste",
          city: "Teste",
          state: "PA",
        },
        items: [{
          product: productId,
          seller: sellerId,
          name: "Produto fictício homologação PIX",
          quantity: 1,
          unitPrice: 50,
          total: 50,
          platformFeePercent: 10,
          platformFeeAmount: 5,
          sellerAmount: 45,
        }],
        platformFeeTotal: 5,
        sellerTotal: 45,
        subtotal: 50,
        shipping: 0,
        discount: 0,
        total: 50,
        paymentStatus: "pending",
        stockReservation: { reserved: true, reservedAt: new Date(), expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) },
        payment: { provider: "mercadopago" },
      }], { session });
    });
  } finally {
    await session.endSession();
  }

  console.log({
    modo: "fixture_local_sandbox",
    banco: mongoose.connection.name,
    pedidoId: String(orderId),
    produtoId: String(productId),
    valorBRL: "50.00",
    estoque: 1,
    estoqueReservado: 1,
    cobrancaCriada: false,
    chamadaMercadoPago: false,
  });
} finally {
  await mongoose.disconnect();
}
