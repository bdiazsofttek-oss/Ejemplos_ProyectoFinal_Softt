import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { createApplication } from '../src/server.js';
import { openDatabase } from '../src/db.js';
import { evaluateObservation } from '../../vision/src/rules.js';

async function fixture(t) {
  const app = createApplication({ db: openDatabase(':memory:') });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  const url = 'http://127.0.0.1:' + app.server.address().port;
  async function call(path, { token, method = 'GET', body, status = 200 } = {}) {
    const response = await fetch(url + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const data = await response.json(); assert.equal(response.status, status, path + ' ' + JSON.stringify(data)); return data;
  }
  const login = async email => (await call('/api/auth/login', { method: 'POST', body: { email, password: 'demo1234' } })).accessToken;
  return { ...app, url, call, login, base: '/api/restaurants/demo' };
}
const tomorrow = () => new Date(Date.now() + 86400000).toISOString().slice(0, 10);
const booking = () => ({ date: tomorrow(), time: '14:00', guests: 2, name: 'Cliente de prueba', email: 'cliente@demo.local', consent: true, tableId: 't1' });

test('pedido → cocina → entrega → cobro → mesa libre, con precios del servidor', async t => {
  const { call, login, base } = await fixture(t);
  const manager = await login('admin@demo.local'); const waiter = await login('mesero@demo.local'); const kitchen = await login('cocina@demo.local');
  const order = await call(base + '/orders', { token: waiter, method: 'POST', status: 201, body: { tableId: 't1', items: [{ productId: 'p1', quantity: 2, priceCents: 1 }, { productId: 'p3', quantity: 1 }] } });
  assert.equal(order.totalCents, 27500);
  await call(base + '/tables/t1/checkout', { token: waiter, method: 'POST', status: 409 });
  await call(base + '/orders/' + order.id, { token: waiter, method: 'PATCH', body: { status: 'preparing' }, status: 403 });
  for (const status of ['preparing', 'ready']) await call(base + '/orders/' + order.id, { token: kitchen, method: 'PATCH', body: { status } });
  await call(base + '/orders/' + order.id, { token: kitchen, method: 'PATCH', body: { status: 'served' }, status: 403 });
  await call(base + '/orders/' + order.id, { token: waiter, method: 'PATCH', body: { status: 'served' } });
  await call(base + '/tables/t1/request-bill', { token: waiter, method: 'POST' });
  const receipt = await call(base + '/tables/t1/checkout', { token: waiter, method: 'POST' });
  assert.equal(receipt.totalCents, 27500); assert.equal(receipt.table.status, 'free');
  const report = await call(base + '/reports', { token: manager }); assert.equal(report.revenueCents, 27500); assert.equal(report.paidOrders, 1);
});

test('reserva pública, concurrencia, correo demo, llegada y liberación', async t => {
  const { call, login, base, db } = await fixture(t); const token = await login('admin@demo.local');
  const invalid = { ...booking(), consent: false };
  await call('/public/restaurants/casa-demo/reservations', { method: 'POST', body: invalid, status: 400 });
  const r = await call('/public/restaurants/casa-demo/reservations', { method: 'POST', body: booking(), status: 201 });
  const retries = await Promise.all([1, 2].map(() => call('/public/restaurants/casa-demo/reservations', { method: 'POST', body: booking(), status: 409 })));
  assert.equal(retries.length, 2);
  assert.equal((await call(base + '/mail', { token })).length, 1);
  await call('/public/reservations/' + r.id + '?token=no', { status: 404 });
  assert.equal((await call('/public/reservations/' + r.id + '?token=' + r.token)).status, 'confirmed');
  db.prepare('UPDATE reservations SET starts_at = ?, ends_at = ? WHERE id = ?').run(new Date(Date.now() + 60000).toISOString(), new Date(Date.now() + 5460000).toISOString(), r.id);
  await call(base + '/reservations/' + r.id, { token, method: 'PATCH', body: { status: 'arrived' } });
  assert.equal((await call(base + '/tables', { token })).find(row => row.id === 't1').status, 'occupied');
  await call(base + '/tables/t1/checkout', { token, method: 'POST' });
  assert.equal((await call(base + '/reservations', { token })).find(row => row.id === r.id).status, 'completed');
});

test('cuentas de cliente solo consultan y cancelan sus propias reservas', async t => {
  const { call, login } = await fixture(t); const token = await login('cliente@demo.local');
  const r = await call('/public/restaurants/casa-demo/reservations', { token, method: 'POST', body: booking(), status: 201 });
  assert.equal((await call('/api/customer/reservations', { token })).length, 1);
  const other = await call('/api/auth/register', { method: 'POST', body: { name: 'Otro', email: 'otro@demo.local', password: 'clave1234' } });
  await call('/api/customer/reservations/' + r.id + '/cancel', { token: other.accessToken, method: 'POST', status: 404 });
  await call('/api/customer/reservations/' + r.id + '/cancel', { token, method: 'POST' });
  assert.equal((await call('/api/customer/reservations', { token }))[0].status, 'cancelled');
});

test('aislamiento entre restaurantes y restricciones de rol en API', async t => {
  const { call, login, base } = await fixture(t); const admin = await login('plataforma@demo.local'); const manager = await login('admin@demo.local');
  const r = await call('/api/restaurants', { token: admin, method: 'POST', status: 201, body: { name: 'Otro restaurante', slug: 'otro-restaurante', city: 'Puebla' } });
  await call('/api/restaurants/' + r.id + '/tables', { token: manager, status: 403 });
  await call(base + '/users', { token: await login('mesero@demo.local'), status: 403 });
  await call(base + '/orders', { token: admin, method: 'POST', status: 400, body: { tableId: 't1', items: [{ productId: 'no-existe', quantity: 1 }] } });
  await call(base + '/reports', { token: await login('cocina@demo.local'), status: 403 });
  await call(base + '/tables', { status: 401 });
  await call('/api/auth/logout', { token: manager, method: 'POST' });
  await call(base + '/tables', { token: manager, status: 401 });
});

test('zonas, simulación de espera, alerta única y atención del mesero', async t => {
  const { call, login, base } = await fixture(t); const token = await login('admin@demo.local');
  await call(base + '/zones', { token, method: 'POST', body: { tableId: 't1', points: [[0, 0], [1, 0], [1, 1]] } });
  for (const action of ['arrive', 'wait', 'wait']) await call(base + '/vision/observe', { token, method: 'POST', body: { tableId: 't1', action } });
  const alerts = await call(base + '/vision-events', { token });
  assert.equal(alerts.filter(v => v.eventType === 'table_unattended').length, 1);
  assert.equal((await call(base + '/tables', { token })).find(t => t.id === 't1').status, 'waiting');
  await call(base + '/vision/observe', { token, method: 'POST', body: { tableId: 't1', action: 'attend' } });
  assert.equal((await call(base + '/vision-events', { token })).filter(v => v.eventType === 'table_unattended' && !v.acknowledgedAt).length, 0);
  assert.equal(evaluateObservation({ guests: 0, waiterPresent: false, secondsSinceService: 100 }, 90).unattended, false);
});

test('borrador separado, publicación, historial y notificación en vivo', async t => {
  const { call, login, base, url } = await fixture(t); const token = await login('admin@demo.local');
  const ws = new WebSocket(url.replace('http', 'ws') + '/ws'); t.after(() => ws.terminate());
  await new Promise(resolve => ws.on('open', resolve));
  const connected = new Promise(resolve => ws.once('message', resolve)); ws.send(JSON.stringify({ token, restaurantId: 'demo' })); await connected;
  const change = new Promise(resolve => ws.once('message', bytes => resolve(JSON.parse(String(bytes)))));
  await call(base + '/page', { token, method: 'PUT', body: { projectData: { pages: [{ component: '<h1>Menú nuevo</h1>' }] }, html: '<h1>Menú nuevo</h1>', css: 'h1{color:green}' } });
  assert.equal((await change).entity, 'page');
  await call('/public/restaurants/casa-demo/page', { status: 404 });
  await call(base + '/page/publish', { token, method: 'POST' });
  assert.match((await call('/public/restaurants/casa-demo/page')).html, /Menú nuevo/);
  const versions = await call(base + '/page/history', { token }); assert.equal(versions.length, 1);
  await call(base + '/page', { token, method: 'PUT', body: { projectData: {}, html: '<h1>Otro borrador</h1>', css: '' } });
  assert.match((await call('/public/restaurants/casa-demo/page')).html, /Menú nuevo/);
  await call(base + '/page/history/' + versions[0].id + '/restore', { token, method: 'POST' });
  assert.match((await call(base + '/page', { token })).html, /Menú nuevo/);
});
