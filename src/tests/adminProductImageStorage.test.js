import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import Product from '../models/Product.js';
import storage from '../config/storage.js';
import { uploadProductImages, deleteProductImage } from '../controllers/productController.js';

const uri = process.env.WALLET_TEST_MONGODB_URI;
function safe(value) {
  if (!value) return false;
  try {
    const u = new URL(value);
    return u.protocol === 'mongodb:' && u.hostname === '127.0.0.1' &&
      u.port === '27018' && u.pathname === '/wallet_test_pix' &&
      u.searchParams.get('replicaSet') === 'walletTestRS';
  } catch { return false; }
}
function res() {
  return { statusCode: 200, payload: null,
    status(n) { this.statusCode = n; return this; },
    json(v) { this.payload = v; return this; } };
}
test('upload and delete persist image changes using mocked R2', {
  skip: !uri ? 'Set WALLET_TEST_MONGODB_URI' : false,
}, async () => {
  assert.ok(safe(uri), 'Unsafe MongoDB URI refused');
  const slug = 'storage-test-' + randomUUID();
  const owner = new mongoose.Types.ObjectId();
  let id;
  const operations = [];
  const sendMock = mock.method(storage, 'send', async (command) => {
    operations.push(command.constructor.name);
    return {};
  });
  const originalPublicUrl = process.env.R2_PUBLIC_URL;
  process.env.R2_PUBLIC_URL = 'https://example.invalid';
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
  try {
    const product = await Product.create({ seller: owner, slug, name: 'Teste de imagens',
      description: 'Produto temporario', price: 10, stock: 1 });
    id = product._id;
    const user = { id: String(owner), role: 'user' };
    const uploaded = res();
    await uploadProductImages({
      params: { id: String(id) }, user,
      files: [{ originalname: 'test.png', mimetype: 'image/png', buffer: Buffer.from('fake image') }],
    }, uploaded);
    assert.equal(uploaded.statusCode, 200);
    assert.equal(operations[0], 'PutObjectCommand');
    const afterUpload = await Product.findById(id);
    assert.equal(afterUpload.images.length, 1);
    assert.equal(afterUpload.coverImage.key, afterUpload.images[0].key);
    const key = afterUpload.images[0].key;
    assert.ok(key.startsWith('products/'));

    const deleted = res();
    await deleteProductImage({ params: { id: String(id) }, user, body: { key } }, deleted);
    assert.equal(deleted.statusCode, 200);
    assert.equal(operations[1], 'DeleteObjectCommand');
    const afterDelete = await Product.findById(id);
    assert.equal(afterDelete.images.length, 0);
    assert.equal(afterDelete.coverImage.key, null);
  } finally {
    if (id) await Product.deleteOne({ _id: id, slug });
    await mongoose.disconnect();
    sendMock.mock.restore();
    if (originalPublicUrl === undefined) delete process.env.R2_PUBLIC_URL;
    else process.env.R2_PUBLIC_URL = originalPublicUrl;
  }
});


test('partial R2 upload failure cleans successful objects and leaves MongoDB unchanged', {
  skip: !uri ? 'Set WALLET_TEST_MONGODB_URI' : false,
}, async () => {
  assert.ok(safe(uri), 'Unsafe MongoDB URI refused');
  const slug = 'storage-failure-' + randomUUID();
  const owner = new mongoose.Types.ObjectId();
  const operations = [];
  let id;
  let uploads = 0;
  const sendMock = mock.method(storage, 'send', async (command) => {
    operations.push(command.constructor.name);
    if (command.constructor.name === 'PutObjectCommand' && ++uploads === 2) {
      throw new Error('Simulated R2 upload failure');
    }
    return {};
  });
  const oldPublicUrl = process.env.R2_PUBLIC_URL;
  process.env.R2_PUBLIC_URL = 'https://example.invalid';
  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
    const product = await Product.create({ seller: owner, slug,
      name: 'Teste de falha no upload', description: 'Registro temporario',
      price: 10, stock: 1 });
    id = product._id;
    const result = res();
    const oldError = console.error;
    console.error = () => {};
    try {
      await uploadProductImages({
        params: { id: String(id) }, user: { id: String(owner), role: 'user' },
        files: [
          { originalname: 'one.png', mimetype: 'image/png', buffer: Buffer.from('fake1') },
          { originalname: 'two.png', mimetype: 'image/png', buffer: Buffer.from('fake2') },
        ],
      }, result);
    } finally {
      console.error = oldError;
    }
    assert.equal(result.statusCode, 500);
    assert.equal(operations.filter(op => op === 'PutObjectCommand').length, 2);
    assert.equal(operations.filter(op => op === 'DeleteObjectCommand').length, 1);
    const unchanged = await Product.findById(id);
    assert.equal(unchanged.images.length, 0);
    assert.equal(unchanged.coverImage.key, null);
  } finally {
    if (id) await Product.deleteOne({ _id: id, slug });
    await mongoose.disconnect();
    sendMock.mock.restore();
    if (oldPublicUrl === undefined) delete process.env.R2_PUBLIC_URL;
    else process.env.R2_PUBLIC_URL = oldPublicUrl;
  }
});
