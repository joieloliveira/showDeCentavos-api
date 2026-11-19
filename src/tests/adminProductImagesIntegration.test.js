import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import Product from '../models/Product.js';
import { uploadProductImages, deleteProductImage, setProductCover } from '../controllers/productController.js';

const uri = process.env.WALLET_TEST_MONGODB_URI;
function isSafeUri(value) {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'mongodb:' && url.hostname === '127.0.0.1' &&
      url.port === '27018' && url.pathname === '/wallet_test_pix' &&
      url.searchParams.get('replicaSet') === 'walletTestRS';
  } catch { return false; }
}
function response() {
  return { statusCode: 200, payload: null,
    status(code) { this.statusCode = code; return this; },
    json(data) { this.payload = data; return this; } };
}
test('image management validates ownership, limits and cover in isolated MongoDB without R2 calls', {
  skip: !uri ? 'Set WALLET_TEST_MONGODB_URI for integration tests' : false,
}, async () => {
  assert.ok(isSafeUri(uri), 'Refusing unsafe MongoDB connection');
  const slug = 'image-test-' + randomUUID();
  const seller = new mongoose.Types.ObjectId();
  let id;
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
  try {
    const product = await Product.create({
      seller, slug, name: 'Produto imagens teste',
      description: 'Registro temporario de teste', price: 25, stock: 1,
      images: [
        { key: 'mock/one.png', url: 'https://example.invalid/one.png' },
        { key: 'mock/two.png', url: 'https://example.invalid/two.png' },
      ],
      coverImage: { key: 'mock/one.png', url: 'https://example.invalid/one.png' },
    });
    id = product._id;
    const admin = { id: new mongoose.Types.ObjectId().toString(), role: 'admin' };
    const outsider = { id: new mongoose.Types.ObjectId().toString(), role: 'user' };

    const denied = response();
    await setProductCover({ params: { id: String(id) }, user: outsider, body: { key: 'mock/two.png' } }, denied);
    assert.equal(denied.statusCode, 403);

    const invalidCover = response();
    await setProductCover({ params: { id: String(id) }, user: admin, body: { key: 'mock/missing.png' } }, invalidCover);
    assert.equal(invalidCover.statusCode, 404);

    const cover = response();
    await setProductCover({ params: { id: String(id) }, user: admin, body: { key: 'mock/two.png' } }, cover);
    assert.equal(cover.statusCode, 200);
    assert.equal((await Product.findById(id)).coverImage.key, 'mock/two.png');

    const missingFile = response();
    await uploadProductImages({ params: { id: String(id) }, user: admin, files: [] }, missingFile);
    assert.equal(missingFile.statusCode, 400);

    const tooMany = response();
    await uploadProductImages({ params: { id: String(id) }, user: admin, files: Array.from({length: 7}, () => ({originalname:'test.png'})) }, tooMany);
    assert.equal(tooMany.statusCode, 400);

    const missingImage = response();
    await deleteProductImage({ params: { id: String(id) }, user: admin, body: { key: 'mock/missing.png' } }, missingImage);
    assert.equal(missingImage.statusCode, 404);
    assert.equal((await Product.findById(id)).images.length, 2);
  } finally {
    if (id) await Product.deleteOne({ _id: id, slug });
    await mongoose.disconnect();
  }
});
