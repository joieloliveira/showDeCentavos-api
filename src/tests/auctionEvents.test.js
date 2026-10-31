import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { publishAuctionEvent, subscribeAuctionEvents } from '../services/AuctionEventsService.js';

function client() {
  const req = new EventEmitter();
  const res = Object.assign(new EventEmitter(), {
    frames: [], headers: {}, destroyed: false, writableEnded: false,
    statusCode: 200,
    setHeader(key, value) { this.headers[key] = value; },
    flushHeaders() {},
    write(value) { this.frames.push(value); return true; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.payload = value; return this; },
    end() { this.writableEnded = true; this.emit('close'); },
  });
  return { req, res };
}

test('SSE broadcasts only to subscribers of the matching auction and cleans up disconnected clients', () => {
  const a = client();
  const b = client();
  const other = client();
  const auctionId = 'test-' + Math.random().toString(36).slice(2);
  subscribeAuctionEvents(a.req, a.res, auctionId);
  subscribeAuctionEvents(b.req, b.res, auctionId);
  subscribeAuctionEvents(other.req, other.res, auctionId + '-other');
  assert.equal(a.res.headers['Content-Type'], 'text/event-stream');
  assert.equal(a.res.headers['X-Accel-Buffering'], 'no');
  const update = { status: 'active', currentPriceCents: 2, bidCount: 2, endsAt: new Date().toISOString() };
  publishAuctionEvent(auctionId, update);
  for (const subscriber of [a, b]) {
    assert.equal(subscriber.res.frames.length, 2);
    const frame = subscriber.res.frames[1];
    assert.ok(frame.startsWith('event: auction-update\n'));
    assert.deepEqual(JSON.parse(frame.split('data: ')[1].trim()), update);
  }
  assert.equal(other.res.frames.length, 1);
  a.req.emit('close');
  publishAuctionEvent(auctionId, { status: 'finished' });
  assert.equal(a.res.frames.length, 2);
  assert.equal(b.res.frames.length, 3);
  b.req.emit('close');
  other.req.emit('close');
});

test('SSE rejects slow consumers to avoid unlimited response buffering', () => {
  const { req, res } = client();
  const auctionId = 'slow-' + Math.random().toString(36).slice(2);
  subscribeAuctionEvents(req, res, auctionId);
  res.write = () => false;
  publishAuctionEvent(auctionId, { status: 'active' });
  assert.equal(res.writableEnded, true);
  req.emit('close');
});
