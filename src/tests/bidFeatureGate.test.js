import test from 'node:test';
import assert from 'node:assert/strict';
import { placeBid } from '../controllers/bidController.js';

test('financial bids are disabled by default without touching database', async () => {
  const previous = process.env.AUCTION_BIDDING_ENABLED;
  delete process.env.AUCTION_BIDDING_ENABLED;
  try {
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; return this; },
    };
    await placeBid({ params: {}, body: {} }, res);
    assert.equal(res.statusCode, 503);
    assert.match(res.body.message, /indisponíveis/);
  } finally {
    if (previous !== undefined) process.env.AUCTION_BIDDING_ENABLED = previous;
  }
});
