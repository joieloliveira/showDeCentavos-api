
import crypto from "node:crypto";

const API_URL = "http://localhost:3001";

const AUCTION_ID = "6ad7dc7c7e414d58203377ad";

// Cole os tokens dos dois usuários comuns.
const TOKEN_1 = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjZhZDUzNzMxZmNiMWQwNWY0NWRlYmRkNSIsInJvbGUiOiJjdXN0b21lciIsImlhdCI6MTc5MjM1OTQ1NSwiZXhwIjoxNzkyOTY0MjU1fQ.J1KbbwArMQQLXY9IopTXhXHojUVx18cLz8nzo9KcdG0";
const TOKEN_2 = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjZhZDUzMTljZmNiMWQwNWY0NWRlYmQ4MyIsInJvbGUiOiJjdXN0b21lciIsImlhdCI6MTc5MjM1OTQ4MSwiZXhwIjoxNzkyOTY0MjgxfQ.q0r9Fa-lBCN9xe7fWHd6-BH_1DwZme8DrYODwKumC4s";

async function enviarLance(nome, token) {
    const inicio = Date.now();

    try {
        const response = await fetch(
            `${API_URL}/api/auctions/${AUCTION_ID}/bids`,
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                    idempotencyKey: crypto.randomUUID(),
                }),
            }
        );

        const data = await response.json();

        return {
            participante: nome,
            httpStatus: response.status,
            tempoMs: Date.now() - inicio,
            resposta: data,
        };
    } catch (error) {
        return {
            participante: nome,
            erro: error.message,
        };
    }
}

async function executarTeste() {
    console.log("Iniciando teste de concorrência...");

    const requisicoes = Array.from({ length: 20 }, (_, index) => {
        const participante = index % 2 === 0 ? 1 : 2;
        const token = participante === 1 ? TOKEN_1 : TOKEN_2;

        return enviarLance(`Participante ${participante}`, token);
    });

    const resultados = await Promise.all(requisicoes);

    console.log(JSON.stringify(resultados, null, 2));
}

executarTeste();
