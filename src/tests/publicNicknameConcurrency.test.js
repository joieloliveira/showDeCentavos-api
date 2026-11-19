import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import User from '../models/User.js';

const uri = process.env.WALLET_TEST_MONGODB_URI;
function safeTestDatabase(value) {
  if (!value) return false;
  try {
    const u = new URL(value);
    return u.protocol === 'mongodb:' && u.hostname === '127.0.0.1' &&
      u.port === '27018' && u.pathname === '/wallet_test_pix' &&
      u.searchParams.get('replicaSet') === 'walletTestRS' &&
      !u.username && !u.password;
  } catch { return false; }
}

test('concurrent public nicknames differ only in case: exactly one succeeds', {
  skip: !safeTestDatabase(uri) && 'Only isolated MongoDB on 127.0.0.1:27018 is allowed',
}, async () => {
  await mongoose.connect(uri, { autoIndex: false });
  const ids = [];
  try {
    await User.collection.createIndex({ publicNickname: 1 }, {
      unique: true,
      partialFilterExpression: { publicNickname: { $type: 'string' } },
      collation: { locale: 'en', strength: 2 },
    });
    const suffix = new mongoose.Types.ObjectId().toString().slice(-10);
    const users = await User.insertMany([
      { name: 'Test User A', email: 'nickname-a-' + suffix + '@example.invalid' },
      { name: 'Test User B', email: 'nickname-b-' + suffix + '@example.invalid' },
    ]);
    ids.push(...users.map(user => user._id));
    const results = await Promise.allSettled([
      User.findByIdAndUpdate(ids[0], { publicNickname: 'Bid_' + suffix }, { runValidators: true }),
      User.findByIdAndUpdate(ids[1], { publicNickname: 'bid_' + suffix }, { runValidators: true }),
    ]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(results.filter(result => result.status === 'rejected' && result.reason?.code === 11000).length, 1);
    assert.equal(await User.countDocuments({ publicNickname: 'bid_' + suffix }).collation({ locale: 'en', strength: 2 }), 1);
  } finally {
    if (ids.length) await User.deleteMany({ _id: { $in: ids } });
    await mongoose.disconnect();
  }
});
