import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { openDatabase } from './db.js';
import { migratePlatform, now, fail, text, integer, email, passwordHash, passwordMatches, makeSession, sessionUser, digest } from './platform-db.js';
import * as ops from './operations.js';
import { events, ingestEvent, observeDemo } from './vision.js';

const simulationDir = resolve(import.meta.dirname, '../../../simulacion.1/simulacion');
const origins = new Set(['http://127.0.0.1:5174', 'http://localhost:5174', 'http://127.0.0.1:5175', 'http://localhost:5175']);

export function createApplication({ db = openDatabase(), framesDir = simulationDir } = {}) {
  migratePlatform(db);
  const limits = new Map();
  const clients = new Map();
  function broadcast(rid, entity) {
    for (const [ws, connection] of clients) {
      const user = sessionUser(db, 'Bearer ' + connection.token);
      if (!user) { ws.close(1008, 'Sesión expirada'); continue; }
      if (connection.rid === rid && ws.readyState === 1) ws.send(JSON.stringify({ type: 'changed', entity, restaurantId: rid, at: now() }));
    }
  }
  function rate(req, key) {
    const id = req.socket.remoteAddress + ':' + key;
    const previous = limits.get(id);
    const current = !previous || previous.until < Date.now() ? { count: 0, until: Date.now() + 600000 } : previous;
    current.count++; limits.set(id, current);
    if (limits.size > 5000) for (const [k, v] of limits) if (v.until < Date.now()) limits.delete(k);
    if (current.count > 120) fail('Demasiados intentos. Intenta más tarde.', 429);
  }
  async function body(req) {
    const chunks = []; let size = 0;
    for await (const chunk of req) { size += chunk.length; if (size > 2000000) fail('Contenido demasiado grande', 413); chunks.push(chunk); }
    try { return size ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}; }
    catch { fail('JSON inválido'); }
  }
  const server = createServer(async (req, res) => {
    const origin = req.headers.origin;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.setHeader('cache-control', 'no-store');
    if (origin && origins.has(origin)) { res.setHeader('access-control-allow-origin', origin); res.setHeader('vary', 'Origin'); }
    res.setHeader('access-control-allow-headers', 'content-type, authorization');
    res.setHeader('access-control-allow-methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    const send = (status, value) => { res.statusCode = status; res.end(JSON.stringify(value)); };
    try {
      if (origin && !origins.has(origin)) fail('Origen no permitido', 403);
      if (req.method === 'OPTIONS') return send(204, {});
      const url = new URL(req.url, 'http://127.0.0.1');
      const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
      const method = req.method;
      if (method === 'GET' && url.pathname === '/health') return send(200, { status: 'ok', database: 'sqlite', version: '0.2.0', vision: 'guided-demo', email: 'demo-outbox' });
      if (method === 'GET' && url.pathname === '/openapi.json') return send(200, JSON.parse(await readFile(resolve(import.meta.dirname, '../../../contracts/openapi.yaml'), 'utf8')));
      if (method === 'POST' && ['/api/auth/login', '/api/auth/register'].includes(url.pathname)) {
        rate(req, 'auth'); const input = await body(req); const address = email(input.email);
        if (url.pathname.endsWith('/register')) {
          const pass = text(input.password, 'Contraseña'); if (pass.length < 8) fail('La contraseña necesita 8 caracteres');
          db.prepare('INSERT INTO users (id, name, email, password_hash, role) VALUES (?, ?, ?, ?, ?)').run(randomUUID(), text(input.name, 'Nombre'), address, passwordHash(pass), 'customer');
        }
        const user = db.prepare('SELECT * FROM users WHERE email = ? AND active = 1').get(address);
        if (!user || !passwordMatches(String(input.password || ''), user.password_hash)) fail('Credenciales inválidas', 401);
        return send(200, makeSession(db, user));
      }
      const user = sessionUser(db, req.headers.authorization);
      if (parts[0] === 'public' && parts[1] === 'restaurants') {
        if (parts.length === 2 && method === 'GET') {
          const params = []; let sql = 'SELECT r.id FROM restaurants r JOIN restaurant_pages p ON p.restaurant_id = r.id WHERE r.active = 1 AND p.published_at IS NOT NULL';
          for (const [key, field] of [['q', 'r.name'], ['city', 'r.city'], ['cuisine', 'r.cuisine']]) if (url.searchParams.get(key)) { sql += ' AND ' + field + ' LIKE ?'; params.push('%' + url.searchParams.get(key).slice(0, 100) + '%'); }
          let list = ops.queryAll(db, sql + ' ORDER BY r.name', ...params).map(row => publicProfile(db, row.id));
          if (url.searchParams.get('guests')) { const guests = integer(url.searchParams.get('guests'), 'Personas', 1, 30); list = list.filter(p => ops.tables(db, p.id).some(t => t.seats >= guests)); }
          return send(200, list);
        }
        const row = db.prepare('SELECT id FROM restaurants WHERE slug = ? AND active = 1').get(parts[2]);
        if (!row) fail('Restaurante no encontrado', 404);
        const rid = row.id;
        if (parts.length === 3 && method === 'GET') return send(200, publicProfile(db, rid));
        if (parts[3] === 'page' && method === 'GET') {
          const page = db.prepare('SELECT published_html AS html, published_css AS css, published_at AS publishedAt FROM restaurant_pages WHERE restaurant_id = ? AND published_at IS NOT NULL').get(rid);
          if (!page) fail('Página aún no publicada', 404);
          return send(200, { ...page, name: ops.restaurant(db, rid).name });
        }
        if (parts[3] === 'availability' && method === 'GET') return send(200, ops.availability(db, rid, Object.fromEntries(url.searchParams)).map(({ id, label, seats }) => ({ id, label, seats })));
        if (parts[3] === 'reservations' && method === 'POST') {
          rate(req, 'reserve'); const input = await body(req);
          if (user?.role === 'customer' && email(input.email) !== user.email) fail('Usa el correo de tu cuenta');
          const reservation = ops.reserve(db, rid, input, user?.role === 'customer' ? user.id : null); broadcast(rid, 'reservations'); return send(201, reservation);
        }
      }
      if (parts[0] === 'public' && parts[1] === 'reservations') {
        const input = method === 'POST' ? await body(req) : {};
        const reservation = db.prepare('SELECT * FROM reservations WHERE id = ? AND secret = ?').get(parts[2], input.token || url.searchParams.get('token') || '');
        if (!reservation) fail('Reserva no encontrada', 404);
        if (method === 'POST' && parts[3] === 'cancel') { const updated = ops.reservationTransition(db, reservation.restaurant_id, reservation.id, 'cancelled'); broadcast(reservation.restaurant_id, 'reservations'); return send(200, updated); }
        if (method === 'GET' && parts.length === 3) return send(200, { ...ops.reservations(db, reservation.restaurant_id).find(r => r.id === reservation.id), restaurant: publicProfile(db, reservation.restaurant_id) });
      }
      if (!user) fail('Se requiere iniciar sesión', 401);
      if (url.pathname === '/api/auth/me' && method === 'GET') return send(200, user);
      if (url.pathname === '/api/auth/logout' && method === 'POST') { db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(digest(String(req.headers.authorization).slice(7))); return send(200, { ok: true }); }
      if (parts[1] === 'customer' && parts[2] === 'reservations') {
        ops.requireRole(user, ['customer']);
        const list = ops.queryAll(db, 'SELECT id, restaurant_id AS restaurantId, secret FROM reservations WHERE customer_id = ? ORDER BY starts_at DESC', user.id);
        if (method === 'GET') return send(200, list.map(r => ({ ...ops.reservations(db, r.restaurantId).find(row => row.id === r.id), restaurant: publicProfile(db, r.restaurantId), confirmationUrl: 'http://127.0.0.1:5175/reserva/' + r.id + '?token=' + r.secret })));
        if (method === 'POST' && parts[4] === 'cancel') {
          const row = list.find(r => r.id === parts[3]); if (!row) fail('Reserva no encontrada', 404);
          const updated = ops.reservationTransition(db, row.restaurantId, row.id, 'cancelled'); broadcast(row.restaurantId, 'reservations'); return send(200, updated);
        }
      }
      if (parts[0] !== 'api' || parts[1] !== 'restaurants') fail('Ruta no encontrada', 404);
      if (parts.length === 2) {
        if (method === 'GET') { ops.requireRole(user, ['platform_admin', 'gerente', 'mesero', 'cocina']); return send(200, ops.queryAll(db, 'SELECT id FROM restaurants' + (user.role === 'platform_admin' ? '' : ' WHERE id = ?'), ...(user.role === 'platform_admin' ? [] : [user.restaurantId])).map(r => ops.restaurant(db, r.id))); }
        if (method === 'POST') { ops.requireRole(user, ops.roles.manage.filter(r => r === 'platform_admin')); return send(201, ops.createRestaurant(db, await body(req))); }
      }
      const rid = parts[2]; ops.scope(user, rid); ops.restaurant(db, rid);
      const section = parts[3]; const id = parts[4]; const input = ['POST', 'PUT', 'PATCH'].includes(method) ? await body(req) : {};
      let result;
      if (!section && method === 'GET') return send(200, ops.restaurant(db, rid));
      if (!section && method === 'PATCH') { ops.requireRole(user, ops.roles.manage); result = ops.saveProfile(db, rid, input); }
      else if (section === 'tables') {
        if (method === 'GET') return send(200, ops.tables(db, rid));
        if (parts[5]) { ops.requireRole(user, ops.roles.service); result = ops.tableAction(db, rid, id, parts[5]); }
        else {
          ops.requireRole(user, ops.roles.manage);
          if (method === 'POST') { const tid = randomUUID(); db.prepare('INSERT INTO restaurant_tables (id, restaurant_id, label, seats, status) VALUES (?, ?, ?, ?, ?)').run(tid, rid, text(input.label, 'Nombre'), integer(input.seats, 'Capacidad', 1, 30), 'free'); result = ops.table(db, rid, tid); }
          else if (method === 'PATCH') { ops.table(db, rid, id); db.prepare('UPDATE restaurant_tables SET label = ?, seats = ? WHERE id = ? AND restaurant_id = ?').run(text(input.label, 'Nombre'), integer(input.seats, 'Capacidad', 1, 30), id, rid); result = ops.table(db, rid, id); }
          else if (method === 'DELETE') {
            const t = ops.table(db, rid, id);
            if (t.status !== 'free' || db.prepare("SELECT id FROM reservations WHERE restaurant_id = ? AND table_id = ? AND status IN ('confirmed','arrived') AND ends_at > ?").get(rid, id, now())) fail('La mesa tiene ocupación o reservas pendientes', 409);
            db.prepare('UPDATE restaurant_tables SET active = 0 WHERE restaurant_id = ? AND id = ?').run(rid, id); result = { ok: true };
          }
        }
      } else if (section === 'products') {
        if (method === 'GET') return send(200, ops.productList(db, rid));
        ops.requireRole(user, ops.roles.manage);
        if (method === 'POST') { const pid = randomUUID(); db.prepare('INSERT INTO products VALUES (?, ?, ?, ?, ?, ?, ?)').run(pid, rid, text(input.name, 'Producto'), text(input.category || 'General', 'Categoría'), String(input.description || '').slice(0, 1000), integer(input.priceCents, 'Precio'), input.active === false ? 0 : 1); result = { id: pid }; }
        else if (method === 'PATCH') { if (!ops.productList(db, rid).some(p => p.id === id)) fail('Producto no encontrado', 404); db.prepare('UPDATE products SET name = ?, category = ?, description = ?, price_cents = ?, active = ? WHERE id = ? AND restaurant_id = ?').run(text(input.name, 'Producto'), text(input.category || 'General', 'Categoría'), String(input.description || ''), integer(input.priceCents, 'Precio'), input.active === false ? 0 : 1, id, rid); result = { id }; }
        else if (method === 'DELETE') { db.prepare('UPDATE products SET active = 0 WHERE id = ? AND restaurant_id = ?').run(id, rid); result = { ok: true }; }
      } else if (section === 'users') {
        ops.requireRole(user, ops.roles.manage);
        if (method === 'GET') return send(200, ops.queryAll(db, 'SELECT id, name, email, role, active FROM users WHERE restaurant_id = ? ORDER BY name', rid));
        if (method === 'POST') result = ops.createUser(db, rid, input);
        else if (method === 'DELETE') { if (id === user.id) fail('No puedes desactivar tu propia cuenta'); db.prepare('UPDATE users SET active = 0 WHERE id = ? AND restaurant_id = ?').run(id, rid); result = { ok: true }; }
      } else if (section === 'orders') {
        if (method === 'GET') return send(200, ops.listOrders(db, rid));
        if (method === 'POST') { ops.requireRole(user, ops.roles.service); result = ops.orderCreate(db, rid, input); }
        else if (method === 'PATCH') result = ops.orderTransition(db, rid, id, input.status, user);
      } else if (section === 'reservations') {
        ops.requireRole(user, ops.roles.service);
        if (method === 'GET') return send(200, ops.reservations(db, rid));
        if (method === 'POST') result = ops.reserve(db, rid, input);
        else if (method === 'PATCH') result = ops.reservationTransition(db, rid, id, input.status);
      } else if (section === 'reports') { ops.requireRole(user, ops.roles.manage); return send(200, ops.reports(db, rid)); }
      else if (section === 'mail') { ops.requireRole(user, ops.roles.manage); return send(200, ops.queryAll(db, 'SELECT id, recipient, subject, body, created_at AS createdAt FROM mail_outbox WHERE restaurant_id = ? ORDER BY created_at DESC LIMIT 50', rid)); }
      else if (section === 'zones') {
        ops.requireRole(user, ops.roles.manage);
        if (method === 'GET') return send(200, ops.queryAll(db, 'SELECT id, table_id AS tableId, points_json AS points FROM zones WHERE restaurant_id = ?', rid).map(z => ({ ...z, points: JSON.parse(z.points) })));
        if (method === 'POST') {
          ops.table(db, rid, input.tableId);
          if (!Array.isArray(input.points) || input.points.length < 3 || input.points.length > 20 || input.points.some(p => !Array.isArray(p) || p.length !== 2 || p.some(n => !Number.isFinite(n) || n < 0 || n > 1))) fail('Dibuja un polígono de 3 a 20 puntos');
          db.prepare('INSERT INTO zones VALUES (?, ?, ?, ?) ON CONFLICT(restaurant_id, table_id) DO UPDATE SET points_json = excluded.points_json').run(randomUUID(), rid, input.tableId, JSON.stringify(input.points)); result = { ok: true };
        } else if (method === 'DELETE') { db.prepare('DELETE FROM zones WHERE id = ? AND restaurant_id = ?').run(id, rid); result = { ok: true }; }
      } else if (section === 'vision-events') {
        if (method === 'GET') return send(200, events(db, rid));
        ops.requireRole(user, ops.roles.service);
        if (method === 'POST' && parts[5] === 'ack') { db.prepare('UPDATE vision_events SET acknowledged_at = ? WHERE id = ? AND restaurant_id = ?').run(now(), id, rid); result = { ok: true }; }
        else if (method === 'POST') { ops.requireRole(user, ops.roles.manage); result = ingestEvent(db, rid, input); }
      } else if (section === 'vision') {
        ops.requireRole(user, ops.roles.manage);
        if (id === 'observe' && method === 'POST') result = observeDemo(db, rid, input);
        else if (id === 'frames' && method === 'GET') {
          const files = (await readdir(framesDir)).filter(f => /^\d{5}\.jpg$/.test(f)).sort();
          if (!parts[5]) return send(200, files.map((name, index) => ({ index, name })));
          const index = integer(parts[5], 'Fotograma', 0, files.length - 1);
          res.setHeader('content-type', 'image/jpeg'); return res.end(await readFile(resolve(framesDir, files[index])));
        }
      } else if (section === 'page') {
        ops.requireRole(user, ops.roles.manage);
        if (!id && method === 'GET') return send(200, ops.getPage(db, rid));
        if (!id && method === 'PUT') result = ops.savePage(db, rid, input);
        else if (id === 'publish' && method === 'POST') result = ops.publishPage(db, rid);
        else if (id === 'history' && method === 'GET') return send(200, ops.queryAll(db, 'SELECT id, published_at AS publishedAt FROM page_versions WHERE restaurant_id = ? ORDER BY published_at DESC', rid));
        else if (id === 'history' && parts[6] === 'restore' && method === 'POST') {
          const row = db.prepare('SELECT project_json AS projectData, html, css FROM page_versions WHERE id = ? AND restaurant_id = ?').get(parts[5], rid);
          if (!row) fail('Versión no encontrada', 404);
          result = ops.savePage(db, rid, { ...row, projectData: JSON.parse(row.projectData) });
        }
      }
      if (result === undefined) fail('Ruta no encontrada', 404);
      broadcast(rid, section || 'profile');
      return send(method === 'POST' && !parts[5] && ['orders','reservations','products','tables','users'].includes(section) ? 201 : 200, result);
    } catch (error) {
      const constraint = /UNIQUE constraint/.test(error.message);
      const status = constraint ? 409 : error.status || 400;
      send(status, { error: constraint ? 'Ese correo o dirección pública ya existe' : error.message || 'Solicitud inválida' });
    }
  });
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 8192 });
  wss.on('connection', (ws, req) => {
    if (req.headers.origin && !origins.has(req.headers.origin)) return ws.close(1008);
    const timer = setTimeout(() => ws.close(1008, 'Autenticación requerida'), 5000); timer.unref();
    ws.on('message', bytes => {
      try {
        const input = JSON.parse(String(bytes)); const user = sessionUser(db, 'Bearer ' + input.token);
        if (!user) fail('Sesión inválida'); ops.scope(user, input.restaurantId); ops.restaurant(db, input.restaurantId);
        clients.set(ws, { token: input.token, rid: input.restaurantId }); clearTimeout(timer);
        ws.send(JSON.stringify({ type: 'connected' }));
      } catch { ws.close(1008, 'Sin acceso'); }
    });
    ws.on('close', () => { clearTimeout(timer); clients.delete(ws); });
    ws.on('error', () => clients.delete(ws));
  });
  return { server, db, broadcast, close: async () => { for (const ws of wss.clients) ws.terminate(); await new Promise(r => server.close(r)); wss.close(); db.close(); } };
}

function publicProfile(db, rid) {
  const { id, name, slug, city, cuisine, address, description, openingTime, closingTime } = ops.restaurant(db, rid);
  return { id, name, slug, city, cuisine, address, description, openingTime, closingTime, menu: ops.productList(db, rid, true).map(({ id, name, category, description, priceCents }) => ({ id, name, category, description, priceCents })) };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const app = createApplication();
  const port = Number(process.env.PORT || 3150);
  app.server.listen(port, process.env.HOST || '127.0.0.1', () => console.log('Beta API 0.2: http://127.0.0.1:' + port));
  const shutdown = () => app.close().then(() => process.exit(0));
  process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
}
