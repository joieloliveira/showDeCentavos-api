const localOrigins = ["http://localhost:3000", "http://127.0.0.1:3000"];

export function allowedCorsOrigins(env = process.env) {
  const configured = (env.CORS_ALLOWED_ORIGINS || "").split(",").map(x => x.trim()).filter(Boolean);
  if (env.NODE_ENV === "production") {
    if (!configured.length) throw new Error("CORS_ALLOWED_ORIGINS é obrigatório em produção.");
    for (const origin of configured) {
      const parsed = new URL(origin);
      if (parsed.protocol !== "https:" || parsed.origin !== origin) {
        throw new Error("CORS_ALLOWED_ORIGINS deve conter apenas origens HTTPS válidas em produção.");
      }
    }
    return configured;
  }
  return configured.length ? configured : localOrigins;
}

export function validateProductionSecrets(env = process.env) {
  if (env.NODE_ENV !== "production") return;
  const secret = env.JWT_SECRET || "";
  if (secret.length < 32 || new Set(secret).size < 12 ||
      /^(secret|changeme|password|jwt_secret|test)/i.test(secret)) {
    throw new Error("JWT_SECRET inseguro ou ausente em produção. Configure um segredo aleatório forte.");
  }
  allowedCorsOrigins(env);
}
