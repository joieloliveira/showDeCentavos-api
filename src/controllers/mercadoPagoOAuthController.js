import crypto from "crypto";

export const connectMercadoPago = async (req, res) => {
  try {
    const state = crypto.randomBytes(32).toString("hex");

    const params = new URLSearchParams({
      client_id: process.env.MERCADOPAGO_CLIENT_ID,
      response_type: "code",
      platform_id: "mp",
      redirect_uri:
        process.env.MERCADOPAGO_REDIRECT_URI,
      state,
    });

    const authorizationUrl =
      `https://auth.mercadopago.com.br/authorization?${params.toString()}`;

    return res.status(200).json({
      authorizationUrl,
      state,
    });
  } catch (error) {
    console.error(
      "Erro ao gerar autorização Mercado Pago:",
      error
    );

    return res.status(500).json({
      message:
        "Erro ao conectar Mercado Pago.",
    });
  }
};