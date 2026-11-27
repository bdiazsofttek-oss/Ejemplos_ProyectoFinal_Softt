import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase, createOrder, validatePageContent } from '../src/db.js';

test('crea un pedido aislado por restaurante y ocupa la mesa', () => {
  const db = openDatabase(':memory:');
  const order = createOrder(db, 'demo', { tableId: 't1', item: 'Tacos', quantity: 2 });
  assert.equal(order.status, 'new');
  assert.equal(db.prepare('SELECT status FROM restaurant_tables WHERE id = ?').get('t1').status, 'occupied');
  assert.equal(db.prepare('SELECT quantity FROM orders WHERE id = ?').get(order.id).quantity, 2);
});

test('rechaza una mesa fuera del restaurante', () => {
  const db = openDatabase(':memory:');
  assert.throws(() => createOrder(db, 'otro', { tableId: 't1', item: 'Tacos' }), /Mesa no encontrada/);
});

test('rechaza scripts y manejadores de eventos en páginas públicas', () => {
  assert.throws(() => validatePageContent({ projectData: {}, html: '<img src=x onerror="alert(1)">', css: '' }), /código no permitido/);
  assert.throws(() => validatePageContent({ projectData: {}, html: '<script>alert(1)</script>', css: '' }), /código no permitido/);
  assert.doesNotThrow(() => validatePageContent({ projectData: { pages: [] }, html: '<section><h1>Menú</h1></section>', css: 'h1{color:tomato}' }));
});
