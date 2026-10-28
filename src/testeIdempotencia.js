
import crypto from "node:crypto";

const API_URL = "http://localhost:3001";

const AUCTION_ID = "6ad7e7a461cd2ad6b4b0e80f";

const TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjZhZDUzNzMxZmNiMWQwNWY0NWRlYmRkNSIsInJvbGUiOiJjdXN0b21lciIsImlhdCI6MTc5MjUzMjkzMiwiZXhwIjoxNzkzMTM3NzMyfQ.0CUglVA6gpZLt5F6f7zOyMzonkWuxb7bx84WsG9ydc0";

// A mesma chave será utilizada nas duas requisições.
const IDEMPOTENCY_KEY = crypto.randomUUID();

async function enviarLance(numero) {
  const inicio = Date.now();

  try {
    const response = await fetch(
      `${API_URL}/api/auctions/${AUCTION_ID}/bids`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${TOKEN}`,
        },
        body: JSON.stringify({
          idempotencyKey: IDEMPOTENCY_KEY,
        }),
      }
    );

    const data = await response.json();

    return {
      requisicao: numero,
      httpStatus: response.status,
      tempoMs: Date.now() - inicio,
      resposta: data,
    };
  } catch (error) {
    return {
      requisicao: numero,
      erro: error.message,
    };
  }
}

async function executarTeste() {
  console.log("Iniciando teste de idempotência simultânea...");

  console.log("Chave utilizada:", IDEMPOTENCY_KEY);

  const resultados = await Promise.all([
    enviarLance(1),
    enviarLance(2),
  ]);

  console.log(JSON.stringify(resultados, null, 2));
}

executarTeste();
