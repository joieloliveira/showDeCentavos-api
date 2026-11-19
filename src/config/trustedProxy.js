import { isIP } from "node:net";

// Only a single, explicitly configured proxy IP is trusted.
// In Docker, configure the exact NGINX container address, not an entire subnet.
export function trustedProxyAddress(env = process.env) {
  const value = (env.TRUSTED_PROXY_IP || "").trim();
  if (!value) return null;
  if (!isIP(value)) throw new Error("TRUSTED_PROXY_IP deve ser um endereço IPv4 ou IPv6 válido.");
  return value;
}

export function configureTrustedProxy(app, env = process.env) {
  const address = trustedProxyAddress(env);
  if (!address) {
    app.set("trust proxy", false);
    return;
  }
  app.set("trust proxy", ip => {
    const normalized = ip.startsWith("::ffff:") ? ip.slice(7) : ip;
    return normalized === address || ip === address;
  });
}
