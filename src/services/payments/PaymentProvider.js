import {
  PAYMENT_PROVIDER,
} from "../../config/marketplace.js";

import MercadoPagoProvider from "./MercadoPagoProvider.js";

/*
 * Providers disponíveis.
 *
 * Futuramente:
 *
 * import PagarmeProvider from "./PagarmeProvider.js";
 */
const providers = {
  mercadopago: MercadoPagoProvider,

  // pagarme: PagarmeProvider,
};

/*
 * Métodos obrigatórios que qualquer
 * provider precisa implementar.
 */
const REQUIRED_METHODS = [
  "createPayment",
  "createPixPayment",
  "getOrder",
  "searchOrders",
  "generateIdempotencyKey",
];

/*
 * Valida se o provider implementa
 * nosso contrato mínimo.
 */
const validateProvider = (
  provider,
  providerName
) => {
  if (!provider) {
    throw new Error(
      `Provedor de pagamento não suportado: ${providerName}`
    );
  }

  if (!provider.name) {
    throw new Error(
      `O provider "${providerName}" não possui propriedade "name".`
    );
  }

  for (const method of REQUIRED_METHODS) {
    if (
      typeof provider[method] !==
      "function"
    ) {
      throw new Error(
        `O provider "${providerName}" não implementa o método obrigatório "${method}".`
      );
    }
  }

  return provider;
};

export const getPaymentProvider = () => {
  const providerName =
    String(
      PAYMENT_PROVIDER
    ).toLowerCase();

  const provider =
    providers[providerName];

  return validateProvider(
    provider,
    providerName
  );
};

export const getPaymentProviderByName = (
  providerName
) => {
  const normalizedName =
    String(providerName).toLowerCase();

  const provider =
    providers[normalizedName];

  return validateProvider(
    provider,
    normalizedName
  );
};

export default getPaymentProvider;