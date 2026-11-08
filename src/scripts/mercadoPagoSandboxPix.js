import "dotenv/config";
import { randomUUID } from "node:crypto";
import { createPixOrder } from "../services/MercadoPagoService.js";

// Script independente de banco, pedidos, estoque e carteira.
// Execute com --env-file=.env.sandbox. Sem --create, nenhuma chamada externa ocorre.
const create = process.argv.includes("--create");
const env = process.env;
const sandbox = env.MERCADOPAGO_SANDBOX_MODE === "true";
const token = env.MERCADOPAGO_ACCESS_TOKEN || "";
const fingerprint = env.MERCADOPAGO_SANDBOX_TOKEN_SHA256 || "";
const allowCreate = env.MERCADOPAGO_SANDBOX_ALLOW_CREATE === "true";

if (!sandbox || !token || !/^[a-f0-9]{64}$/i.test(fingerprint)) {
  throw new Error("Sandbox incompleto. Configure modo, token e impressão digital.");
}

if (!create) {
  console.log({
    modo: "simulacao_local",
    sandbox,
    credencialConfigurada: Boolean(token),
    impressaoDigitalConfigurada: true,
    criacaoAutorizadaNoAmbiente: allowCreate,
    chamadaExterna: false,
    valorPrevistoBRL: "1.00"
  });
  console.log("Nenhuma cobrança foi criada. Use --create apenas após autorização.");
} else {
  if (!allowCreate) {
    throw new Error("Criação bloqueada. MERCADOPAGO_SANDBOX_ALLOW_CREATE deve ser true.");
  }
  // Referência sintética válida; não aponta para qualquer pedido local.
  const order = { _id: { toString: () => randomUUID() }, total: 1 };
  const result = await createPixOrder({
    order,
    payer: {},
    idempotencyKey: randomUUID(),
    sandboxAuthorized: true
  });
  console.log({
    modo: "criacao_sandbox",
    providerOrderId: result?.id ? String(result.id) : null,
    status: result?.status || null,
    cobrancaCriada: Boolean(result?.id)
  });
  // Nunca imprimir token, QR code, dados do pagador ou resposta completa.
}
