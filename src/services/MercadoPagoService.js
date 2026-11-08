import axios from "axios";
import { createHash, timingSafeEqual } from "node:crypto";
import { v4 as uuidv4 } from "uuid";

// Em sandbox, uma impressão digital previamente fixada impede uso acidental
// de outro token. O prefixo APP_USR é válido também para credenciais de teste.
const mercadoPagoAccessToken = () => {
  const token = process.env.MERCADOPAGO_ACCESS_TOKEN || "";
  if (!token) throw new Error("MERCADOPAGO_ACCESS_TOKEN não configurado.");
  if (process.env.MERCADOPAGO_SANDBOX_MODE === "true") {
    const expected = process.env.MERCADOPAGO_SANDBOX_TOKEN_SHA256 || "";
    if (!/^[a-f0-9]{64}$/i.test(expected)) {
      throw new Error("Homologação bloqueada: configure MERCADOPAGO_SANDBOX_TOKEN_SHA256.");
    }
    const actual = createHash("sha256").update(token).digest();
    const pinned = Buffer.from(expected, "hex");
    if (!timingSafeEqual(actual, pinned)) {
      throw new Error("Homologação bloqueada: credencial diferente da credencial de teste fixada.");
    }
  }
  return token;
};

const assertSandboxCreationAuthorized = (sandboxAuthorized) => {
  if (process.env.MERCADOPAGO_SANDBOX_MODE !== "true") return;
  // Nunca permitir que uma rota comum crie pagamentos em homologação.
  if (process.env.MERCADOPAGO_SANDBOX_ALLOW_CREATE !== "true" || sandboxAuthorized !== true) {
    throw new Error("Criação de pagamento sandbox bloqueada: autorização explícita necessária.");
  }
  mercadoPagoAccessToken();
};

const mercadoPagoApi = axios.create({
  baseURL: "https://api.mercadopago.com",
  headers: {
    "Content-Type": "application/json",
  },
});

export const createPixOrder = async ({
  order,
  payer,
  idempotencyKey,
  sandboxAuthorized = false,
}) => {
  assertSandboxCreationAuthorized(sandboxAuthorized);
  const body = {
    type: "online",

    processing_mode: "automatic",

    external_reference:
      order._id.toString(),

    total_amount:
      order.total.toFixed(2),

    payer: {
      email: "test_user_br@testuser.com",
      first_name: "APRO",
    },

    transactions: {
      payments: [
        {
          amount:
            order.total.toFixed(2),

          expiration_time: "PT30M",

          payment_method: {
            id: "pix",
            type: "bank_transfer",
          },
        },
      ],
    },
  };

  try {
    const response =
      await mercadoPagoApi.post(
        "/v1/orders",
        body,
        {
          headers: {
            Authorization:
              `Bearer ${mercadoPagoAccessToken()}`,

            "X-Idempotency-Key":
              idempotencyKey,
          },
        }
      );

    return response.data;
  } catch (error) {
    const providerOrder =
      error.response?.data?.data;

    if (
      providerOrder?.id &&
      providerOrder?.external_reference ===
      order._id.toString()
    ) {
      return providerOrder;
    }

    throw error;
  }
};

export const createCardOrder = async ({
  order,
  payer,
  card,
  idempotencyKey,
  sandboxAuthorized = false,
}) => {
  assertSandboxCreationAuthorized(sandboxAuthorized);
  const body = {
    type: "online",

    processing_mode: "automatic",

    external_reference:
      order._id.toString(),

    total_amount:
      order.total.toFixed(2),

    payer: {
      email: payer.email,

      identification:
        payer.identification,
    },

    transactions: {
      payments: [
        {
          amount:
            order.total.toFixed(2),

          payment_method: {
            id:
              card.paymentMethodId,

            type:
              card.paymentTypeId,

            token:
              card.token,

            installments:
              card.installments,
          },
        },
      ],
    },
  };

  try {
    const response =
      await mercadoPagoApi.post(
        "/v1/orders",
        body,
        {
          headers: {
            Authorization:
              `Bearer ${mercadoPagoAccessToken()}`,

            "X-Idempotency-Key":
              idempotencyKey,
          },
        }
      );

    return response.data;
  } catch (error) {
    const providerOrder =
      error.response?.data?.data;

    if (
      providerOrder?.id &&
      providerOrder?.external_reference ===
      order._id.toString()
    ) {
      return providerOrder;
    }

    throw error;
  }
};

export const generateIdempotencyKey = () => {
  return uuidv4();
};

export const getMercadoPagoOrder = async (
  mercadoPagoOrderId
) => {
  const response = await mercadoPagoApi.get(
    `/v1/orders/${mercadoPagoOrderId}`,
    {
      headers: {
        Authorization:
          `Bearer ${mercadoPagoAccessToken()}`,
      },
    }
  );

  return response.data;
};

export const searchMercadoPagoOrders = async ({
  externalReference,
  beginDate,
  endDate,
}) => {
  const response = await mercadoPagoApi.get(
    "/v1/orders",
    {
      headers: {
        Authorization:
          `Bearer ${mercadoPagoAccessToken()}`,
      },
      params: {
        external_reference: externalReference,
        begin_date: beginDate,
        end_date: endDate,
      },
    }
  );

  return response.data;
};

export const inspectMercadoPagoOrderSearch = async ({
  externalReference,
  beginDate,
  endDate,
}) => {
  const result = await searchMercadoPagoOrders({
    externalReference,
    beginDate,
    endDate,
  });

  return {
    responseType: Array.isArray(result) ? "array" : typeof result,
    topLevelKeys:
      result && !Array.isArray(result) && typeof result === "object"
        ? Object.keys(result)
        : [],
    resultCount: Array.isArray(result)
      ? result.length
      : null,
    resultFieldTypes:
      result && !Array.isArray(result) && typeof result === "object"
        ? Object.fromEntries(
          Object.entries(result).map(([key, value]) => [
            key,
            Array.isArray(value)
              ? "array"
              : value === null
                ? "null"
                : typeof value,
          ])
        )
        : {},
  };
};