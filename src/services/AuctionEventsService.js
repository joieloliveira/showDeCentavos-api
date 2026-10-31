// Server-Sent Events (SSE): native HTTP push, no extra dependencies.
// This is per-process fan-out; a shared broker will be needed for multi-instance deployment.
const clients = new Map();
const MAX_CLIENTS_PER_AUCTION = 100;
const MAX_CLIENTS_TOTAL = 1000;

export function publishAuctionEvent(auctionId, payload) {
  const subscribers = clients.get(String(auctionId));
  if (!subscribers) return;
  const frame = 'event: auction-update\ndata: ' + JSON.stringify(payload) + '\n\n';
  for (const res of [...subscribers]) {
    if (res.destroyed || res.writableEnded) {
      subscribers.delete(res);
      continue;
    }
    if (!res.write(frame)) {
      // Disconnect slow consumers instead of buffering unbounded data.
      res.end();
      subscribers.delete(res);
    }
  }
  if (subscribers.size === 0) clients.delete(String(auctionId));
}

export function subscribeAuctionEvents(req, res, auctionId) {
  const key = String(auctionId);
  const subscribers = clients.get(key) ?? new Set();
  const total = [...clients.values()].reduce((sum, set) => sum + set.size, 0);
  if (total >= MAX_CLIENTS_TOTAL || subscribers.size >= MAX_CLIENTS_PER_AUCTION) {
    return res.status(503).json({ message: 'Limite de conexões simultâneas atingido.' });
  }
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
  subscribers.add(res);
  clients.set(key, subscribers);
  res.write(': connected\n\n');
  const heartbeat = setInterval(() => {
    if (res.destroyed || res.writableEnded) return cleanup();
    res.write(': heartbeat\n\n');
  }, 20000);
  heartbeat.unref?.();
  function cleanup() {
    clearInterval(heartbeat);
    subscribers.delete(res);
    if (subscribers.size === 0) clients.delete(key);
  }
  req.on('close', cleanup);
  res.on('close', cleanup);
}
