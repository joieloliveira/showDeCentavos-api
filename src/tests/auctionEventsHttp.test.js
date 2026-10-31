import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import { once } from 'node:events';
import { publishAuctionEvent, subscribeAuctionEvents } from '../services/AuctionEventsService.js';

// Real HTTP streaming test, no MongoDB, wallets, payments or real auctions.
test('two HTTP SSE clients receive auction updates; unrelated clients do not', async () => {
  const app = express();
  app.get('/auctions/:id/events', (req, res) =>
    subscribeAuctionEvents(req, res, req.params.id));
  const server = http.createServer(app);
  const controllers = [];
  const readers = [];
  try {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const port = server.address().port;
    const connect = async (id) => {
      const controller = new AbortController();
      controllers.push(controller);
      const response = await fetch(`http://127.0.0.1:${port}/auctions/${id}/events`, {
        signal: controller.signal,
        headers: { Accept: 'text/event-stream' },
      });
      assert.equal(response.status, 200);
      assert.match(response.headers.get('content-type'), /text\/event-stream/);
      const reader = response.body.getReader();
      readers.push(reader);
      const initial = await reader.read();
      assert.match(new TextDecoder().decode(initial.value), /: connected/);
      return reader;
    };
    const first = await connect('auction-a');
    const second = await connect('auction-a');
    const unrelated = await connect('auction-b');
    const payload = {
      status: 'active', currentPriceCents: 3, bidCount: 3,
      endsAt: new Date(Date.now() + 15000).toISOString(),
    };
    publishAuctionEvent('auction-a', payload);
    for (const reader of [first, second]) {
      const chunk = await reader.read();
      const frame = new TextDecoder().decode(chunk.value);
      assert.match(frame, /^event: auction-update\n/);
      assert.deepEqual(JSON.parse(frame.split('data: ')[1].trim()), payload);
    }
    // A different auction must not receive this event.
    // Its stream is still connected; publish a targeted event to prove routing.
    publishAuctionEvent('auction-b', { status: 'finished' });
    const chunk = await unrelated.read();
    const frame = new TextDecoder().decode(chunk.value);
    assert.match(frame, /"status":"finished"/);
    assert.doesNotMatch(frame, /"currentPriceCents":3/);
  } finally {
    for (const controller of controllers) controller.abort();
    for (const reader of readers) {
      try { await reader.cancel(); } catch { /* aborted stream */ }
    }
    await new Promise(resolve => server.close(resolve));
    server.closeAllConnections();
  }
});
