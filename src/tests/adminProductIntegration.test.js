import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import Product from '../models/Product.js';
import { createAdminProduct, updateAdminProduct } from '../controllers/adminProductController.js';

const uri = process.env.WALLET_TEST_MONGODB_URI;
function safeTestUri(value) {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'mongodb:' &&
      url.hostname === '127.0.0.1' &&
      url.port === '27018' &&
      url.pathname === '/wallet_test_pix' &&
      url.searchParams.get('replicaSet') === 'walletTestRS';
  } catch { return false; }
}
function response() {
  return {
    statusCode: 200,
    payload: null,
    status(code) { this.statusCode = code; return this; },
    json(data) { this.payload = data; return this; },
  };
}

test('admin product creation and editing use only the isolated test database', {
  skip: !uri ? 'Set WALLET_TEST_MONGODB_URI to run MongoDB integration tests' : false,
}, async () => {
  assert.ok(safeTestUri(uri), 'Refusing to connect: expected local wallet_test_pix on port 27018');
  const suffix = randomUUID().replaceAll('-', '');
  const slug = 'automated-product-' + suffix;
  const seller = new mongoose.Types.ObjectId();
  let createdId;
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
  try {
    const createRes = response();
    await createAdminProduct({
      user: { id: seller.toString() },
      body: { name: 'Produto de teste', slug, description: 'Criado somente para teste automatizado', price: 150.5, stock: 3 },
    }, createRes);
    assert.equal(createRes.statusCode, 201);
    createdId = createRes.payload.product._id;
    assert.equal(createRes.payload.product.status, 'draft');
    const stored = await Product.findById(createdId).lean();
    assert.equal(stored.slug, slug);
    assert.equal(stored.stock, 3);

    const invalidRes = response();
    await updateAdminProduct({ params: { id: String(createdId) }, body: { stock: -1 } }, invalidRes);
    assert.equal(invalidRes.statusCode, 400);

    const updateRes = response();
    await updateAdminProduct({
      params: { id: String(createdId) },
      body: { name: 'Produto atualizado', price: 180, stock: 4, status: 'active' },
    }, updateRes);
    assert.equal(updateRes.statusCode, 200);
    const updated = await Product.findById(createdId).lean();
    assert.equal(updated.name, 'Produto atualizado');
    assert.equal(updated.price, 180);
    assert.equal(updated.stock, 4);
    assert.equal(updated.status, 'active');
  } finally {
    if (createdId) await Product.deleteOne({ _id: createdId, slug });
    await mongoose.disconnect();
  }
});
