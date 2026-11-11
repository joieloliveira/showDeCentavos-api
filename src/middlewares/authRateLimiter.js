// Per-process throttle. For multi-instance deployments use a shared store (e.g. Redis).
export const createAuthRateLimiter = ({ maxAttempts, windowMs }) => {
  const attempts = new Map();
  let requests = 0;
  return (req, res, next) => {
    const now = Date.now();
    // Express resolves req.ip using only the explicitly trusted proxy, if configured.
    const ip = req.ip || req.socket?.remoteAddress || "unknown";
    const key = ip;
    if (++requests % 100 === 0) {
      for (const [entry, value] of attempts) {
        if (value.resetAt <= now) attempts.delete(entry);
      }
    }
    let state = attempts.get(key);
    if (!state || state.resetAt <= now) {
      state = { count: 0, resetAt: now + windowMs };
      attempts.set(key, state);
    }
    if (state.count >= maxAttempts) {
      const seconds = Math.max(1, Math.ceil((state.resetAt - now) / 1000));
      res.set("Retry-After", String(seconds));
      return res.status(429).json({ message: "Muitas tentativas. Aguarde e tente novamente." });
    }
    state.count += 1;
    next();
  };
};
