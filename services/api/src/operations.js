import { randomUUID, randomBytes } from 'node:crypto';
import sanitizeHtml from 'sanitize-html';
import { now, fail, text, integer, email, transaction, passwordHash } from './platform-db.js';
import { validatePageContent } from './db.js';

export const roles = { manage: ['platform_admin', 'gerente'], service: ['platform_admin', 'gerente', 'mesero'], kitchen: ['platform_admin', 'gerente', 'cocina'] };
export function requireRole(user, allowed) { if (!user || !allowed.includes(user.role)) fail('No tienes permisos para esta acción', 403); }
export function scope(user, restaurantId) { if (!user || user.role === 'customer' || (user.role !== 'platform_admin' && user.restaurantId !== restaurantId)) fail('Restaurante fuera de tu sesión', 403); }
export const queryAll = (db, sql, ...args) => db.prepare(sql).all(...args);
export function restaurant(db, id) {
  const row = db.prepare('SELECT id, slug, name, city, cuisine, description, address, opening_time AS openingTime, closing_time AS closingTime, threshold_seconds AS thresholdSeconds, active FROM restaurants WHERE id = ?').get(id);
  if (!row) fail('Restaurante no encontrado', 404);
  return row;
}
export function tables(db, rid) { return queryAll(db, 'SELECT id, label, seats, status, occupied_at AS occupiedAt, last_service_at AS lastServiceAt FROM restaurant_tables WHERE restaurant_id = ? AND active = 1 ORDER BY label', rid); }
export function table(db, rid, id) { const row = tables(db, rid).find(t => t.id === id); if (!row) fail('Mesa no encontrada', 404); return row; }
export function productList(db, rid, onlyActive = false) { return queryAll(db, 'SELECT id, name, category, description, price_cents AS priceCents, active FROM products WHERE restaurant_id = ?' + (onlyActive ? ' AND active = 1' : '') + ' ORDER BY category, name', rid); }
export function ensureVisit(db, rid, tid) {
  const t = table(db, rid, tid); const timestamp = now();
  db.prepare('INSERT OR IGNORE INTO table_visits (id, restaurant_id, table_id, opened_at) VALUES (?, ?, ?, ?)').run(randomUUID(), rid, tid, timestamp);
  db.prepare("UPDATE restaurant_tables SET occupied_at = COALESCE(occupied_at, ?), last_service_at = COALESCE(last_service_at, ?), status = CASE WHEN status = 'free' THEN 'occupied' ELSE status END WHERE id = ? AND restaurant_id = ?").run(timestamp, timestamp, tid, rid);
  return t;
}
function attended(db, rid, tid) {
  const timestamp = now();
  db.prepare('UPDATE restaurant_tables SET last_service_at = ? WHERE restaurant_id = ? AND id = ?').run(timestamp, rid, tid);
  db.prepare('UPDATE table_visits SET first_service_at = COALESCE(first_service_at, ?) WHERE restaurant_id = ? AND table_id = ? AND closed_at IS NULL').run(timestamp, rid, tid);
  db.prepare('UPDATE vision_events SET acknowledged_at = ? WHERE restaurant_id = ? AND table_id = ? AND acknowledged_at IS NULL').run(timestamp, rid, tid);
  db.prepare('UPDATE vision_state SET elapsed_seconds = 0 WHERE restaurant_id = ? AND table_id = ?').run(rid, tid);
}
export function listOrders(db, rid) {
  return queryAll(db, 'SELECT o.id, o.table_id AS tableId, t.label AS tableLabel, o.item, o.quantity, o.status, o.notes, o.total_cents AS totalCents, o.created_at AS createdAt FROM orders o JOIN restaurant_tables t ON t.id = o.table_id WHERE o.restaurant_id = ? ORDER BY o.created_at DESC', rid).map(o => ({ ...o, items: queryAll(db, 'SELECT product_id AS productId, name, quantity, price_cents AS priceCents FROM order_items WHERE order_id = ? AND restaurant_id = ?', o.id, rid) }));
}
export function orderCreate(db, rid, input) {
  table(db, rid, input.tableId);
  if (!Array.isArray(input.items) || !input.items.length || input.items.length > 40) fail('Agrega al menos un producto');
  const lines = input.items.map(line => {
    const p = productList(db, rid, true).find(product => product.id === line.productId);
    if (!p) fail('Producto no disponible');
    return { ...p, quantity: integer(line.quantity, 'Cantidad', 1, 99) };
  });
  const id = randomUUID(); const total = lines.reduce((sum, line) => sum + line.priceCents * line.quantity, 0);
  return transaction(db, () => {
    ensureVisit(db, rid, input.tableId);
    db.prepare('INSERT INTO orders (id, restaurant_id, table_id, item, quantity, status, created_at, notes, total_cents, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id, rid, input.tableId, lines.map(l => l.name + ' × ' + l.quantity).join(', '), lines.reduce((n, l) => n + l.quantity, 0), 'new', now(), String(input.notes || '').slice(0, 500), total, now());
    const insert = db.prepare('INSERT INTO order_items VALUES (?, ?, ?, ?, ?, ?, ?)');
    for (const l of lines) insert.run(randomUUID(), rid, id, l.id, l.name, l.quantity, l.priceCents);
    attended(db, rid, input.tableId);
    db.prepare("UPDATE restaurant_tables SET status = 'ordered' WHERE id = ? AND restaurant_id = ?").run(input.tableId, rid);
    return listOrders(db, rid).find(o => o.id === id);
  });
}
export function orderTransition(db, rid, id, status, user) {
  const order = listOrders(db, rid).find(o => o.id === id); if (!order) fail('Pedido no encontrado', 404);
  const transitions = { new: ['preparing', 'cancelled'], preparing: ['ready', 'cancelled'], ready: ['served'], served: [], paid: [], cancelled: [] };
  if (!(transitions[order.status] || []).includes(status)) fail('Cambio de estado de pedido no permitido', 409);
  requireRole(user, status === 'served' ? roles.service : status === 'cancelled' ? roles.service : roles.kitchen);
  db.prepare('UPDATE orders SET status = ?, updated_at = ? WHERE id = ? AND restaurant_id = ?').run(status, now(), id, rid);
  if (status === 'served') attended(db, rid, order.tableId);
  return listOrders(db, rid).find(o => o.id === id);
}
export function tableAction(db, rid, tid, action) {
  const t = table(db, rid, tid);
  if (action === 'occupy') { if (t.status !== 'free') fail('La mesa ya está ocupada', 409); ensureVisit(db, rid, tid); }
  else if (action === 'request-bill') { if (t.status === 'free') fail('La mesa está libre', 409); db.prepare("UPDATE restaurant_tables SET status = 'bill' WHERE id = ? AND restaurant_id = ?").run(tid, rid); }
  else if (action === 'checkout') {
    if (t.status === 'free') fail('La mesa ya está libre', 409);
    const unpaid = listOrders(db, rid).filter(o => o.tableId === tid && !['paid', 'cancelled'].includes(o.status));
    if (unpaid.some(o => o.status !== 'served')) fail('Entrega o cancela todos los pedidos antes de cobrar', 409);
    return transaction(db, () => {
      db.prepare("UPDATE orders SET status = 'paid', updated_at = ? WHERE restaurant_id = ? AND table_id = ? AND status = 'served'").run(now(), rid, tid);
      db.prepare("UPDATE restaurant_tables SET status = 'free', occupied_at = NULL, last_service_at = NULL WHERE id = ? AND restaurant_id = ?").run(tid, rid);
      db.prepare('UPDATE table_visits SET closed_at = ? WHERE restaurant_id = ? AND table_id = ? AND closed_at IS NULL').run(now(), rid, tid);
      db.prepare("UPDATE reservations SET status = 'completed' WHERE restaurant_id = ? AND table_id = ? AND status = 'arrived'").run(rid, tid);
      db.prepare('DELETE FROM vision_state WHERE restaurant_id = ? AND table_id = ?').run(rid, tid);
      db.prepare('UPDATE vision_events SET acknowledged_at = ? WHERE restaurant_id = ? AND table_id = ? AND acknowledged_at IS NULL').run(now(), rid, tid);
      return { totalCents: unpaid.reduce((sum, o) => sum + o.totalCents, 0), paymentMode: 'demo-cash', table: table(db, rid, tid) };
    });
  } else fail('Acción desconocida');
  return table(db, rid, tid);
}

function slot(db, rid, input) {
  const profile = restaurant(db, rid); const date = String(input.date || ''); const time = String(input.time || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) fail('Fecha u hora inválida');
  const startsAt = new Date(date + 'T' + time + ':00-06:00');
  if (!Number.isFinite(startsAt.getTime()) || startsAt.toISOString().slice(0, 10) !== date || startsAt.getTime() < Date.now() - 300000) fail('Elige una fecha y hora futuras');
  const minutes = Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
  const minuteOf = t => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
  if (minutes < minuteOf(profile.openingTime) || minutes + 90 > minuteOf(profile.closingTime)) fail('La reserva de 90 minutos debe quedar dentro del horario');
  return { startsAt: startsAt.toISOString(), endsAt: new Date(startsAt.getTime() + 90 * 60000).toISOString(), guests: integer(input.guests, 'Personas', 1, 30) };
}
export function availability(db, rid, input) {
  const interval = slot(db, rid, input);
  return tables(db, rid).filter(t => t.seats >= interval.guests).filter(t => {
    const conflict = db.prepare("SELECT id FROM reservations WHERE restaurant_id = ? AND table_id = ? AND status IN ('confirmed','arrived') AND starts_at < ? AND ends_at > ?").get(rid, t.id, interval.endsAt, interval.startsAt);
    const immediate = Date.parse(interval.startsAt) < Date.now() + 90 * 60000;
    return !conflict && !(immediate && t.status !== 'free');
  });
}
export function reservations(db, rid) { return queryAll(db, 'SELECT r.id, r.table_id AS tableId, t.label AS tableLabel, r.customer_name AS name, r.email, r.guests, r.starts_at AS startsAt, r.ends_at AS endsAt, r.status, r.created_at AS createdAt FROM reservations r JOIN restaurant_tables t ON t.id = r.table_id WHERE r.restaurant_id = ? ORDER BY r.starts_at DESC', rid); }
export function reserve(db, rid, input, customerId = null) {
  if (input.consent !== true) fail('Se requiere consentimiento de privacidad');
  const name = text(input.name, 'Nombre'); const address = email(input.email); const interval = slot(db, rid, input);
  return transaction(db, () => {
    const candidates = availability(db, rid, input); const chosen = input.tableId ? candidates.find(t => t.id === input.tableId) : candidates[0];
    if (!chosen) fail('Esa mesa u horario ya no está disponible', 409);
    const id = randomUUID(); const secret = randomBytes(24).toString('hex');
    db.prepare('INSERT INTO reservations VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id, rid, chosen.id, customerId, name, address, interval.guests, interval.startsAt, interval.endsAt, 'confirmed', secret, now(), now());
    const link = 'http://127.0.0.1:5175/reserva/' + id + '?token=' + secret;
    db.prepare('INSERT INTO mail_outbox VALUES (?, ?, ?, ?, ?, ?)').run(randomUUID(), rid, address, 'Reserva confirmada — ' + restaurant(db, rid).name, 'Hola ' + name + '. Reserva para ' + interval.guests + ' personas. ' + input.date + ' ' + input.time + '. Consulta o cancela: ' + link, now());
    return { ...reservations(db, rid).find(r => r.id === id), token: secret, confirmationUrl: link, emailMode: 'demo-outbox' };
  });
}
export function reservationTransition(db, rid, id, status) {
  const r = reservations(db, rid).find(row => row.id === id); if (!r) fail('Reserva no encontrada', 404);
  if (status === 'cancelled' && r.status === 'confirmed') db.prepare('UPDATE reservations SET status = ? WHERE id = ? AND restaurant_id = ?').run(status, id, rid);
  else if (status === 'arrived' && r.status === 'confirmed') {
    if (table(db, rid, r.tableId).status !== 'free') fail('La mesa sigue ocupada', 409);
    if (Date.parse(r.endsAt) < Date.now() || Date.parse(r.startsAt) > Date.now() + 90 * 60000) fail('La llegada se registra cerca del horario reservado', 409);
    transaction(db, () => { ensureVisit(db, rid, r.tableId); db.prepare('UPDATE reservations SET status = ? WHERE id = ? AND restaurant_id = ?').run(status, id, rid); });
  } else fail('Cambio de estado de reserva no permitido', 409);
  return reservations(db, rid).find(row => row.id === id);
}

export function saveProfile(db, rid, input) {
  const current = restaurant(db, rid); const p = { ...current, ...input };
  const slug = text(p.slug, 'Dirección pública'); if (!/^[a-z0-9-]{3,60}$/.test(slug) || ['reserva', 'cuenta'].includes(slug)) fail('Dirección pública inválida');
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(p.openingTime) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(p.closingTime) || p.openingTime >= p.closingTime) fail('Horario inválido');
  db.prepare('UPDATE restaurants SET name = ?, slug = ?, city = ?, cuisine = ?, description = ?, address = ?, opening_time = ?, closing_time = ?, threshold_seconds = ?, active = ? WHERE id = ?').run(text(p.name, 'Nombre'), slug, text(p.city, 'Ciudad'), text(p.cuisine, 'Cocina'), String(p.description || '').slice(0, 2000), String(p.address || '').slice(0, 300), p.openingTime, p.closingTime, integer(p.thresholdSeconds, 'Umbral', 15, 3600), p.active ? 1 : 0, rid);
  return restaurant(db, rid);
}
export function createRestaurant(db, input) {
  return transaction(db, () => {
    const id = randomUUID();
    db.prepare('INSERT INTO restaurants (id, slug, name, city) VALUES (?, ?, ?, ?)').run(id, text(input.slug, 'Dirección pública'), text(input.name, 'Nombre'), text(input.city, 'Ciudad'));
    saveProfile(db, id, input);
    db.prepare('INSERT INTO restaurant_pages (restaurant_id, draft_json, draft_html, draft_css, updated_at) VALUES (?, ?, ?, ?, ?)').run(id, JSON.stringify({ pages: [{ component: '<section><h1>Bienvenidos</h1><p>Conoce nuestro restaurante.</p></section>' }] }), '<section><h1>Bienvenidos</h1></section>', '', now());
    return restaurant(db, id);
  });
}
export function createUser(db, rid, input) {
  if (!['gerente', 'mesero', 'cocina'].includes(input.role)) fail('Rol inválido');
  const id = randomUUID(); const pass = text(input.password, 'Contraseña'); if (pass.length < 8) fail('La contraseña necesita 8 caracteres');
  db.prepare('INSERT INTO users (id, restaurant_id, name, email, password_hash, role) VALUES (?, ?, ?, ?, ?, ?)').run(id, rid, text(input.name, 'Nombre'), email(input.email), passwordHash(pass), input.role);
  return { id };
}
export function getPage(db, rid) {
  const row = db.prepare('SELECT draft_json AS projectData, draft_html AS html, draft_css AS css, updated_at AS updatedAt, published_at AS publishedAt FROM restaurant_pages WHERE restaurant_id = ?').get(rid);
  if (!row) fail('Página no encontrada', 404);
  return { ...row, projectData: JSON.parse(row.projectData) };
}
export function savePage(db, rid, input) {
  const page = validatePageContent(input);
  db.prepare('UPDATE restaurant_pages SET draft_json = ?, draft_html = ?, draft_css = ?, updated_at = ? WHERE restaurant_id = ?').run(JSON.stringify(page.projectData), page.html, page.css, now(), rid);
  return getPage(db, rid);
}
export function publishPage(db, rid) {
  const page = getPage(db, rid); validatePageContent(page);
  const html = sanitizeHtml(page.html, { allowedTags: sanitizeHtml.defaults.allowedTags.concat(['section', 'article', 'header', 'footer', 'nav', 'main', 'img']), allowedAttributes: { '*': ['class', 'id', 'style'], a: ['href', 'title', 'target', 'rel'], img: ['src', 'alt', 'width', 'height'] }, allowedSchemes: ['http', 'https', 'mailto', 'tel'] });
  return transaction(db, () => {
    db.prepare('UPDATE restaurant_pages SET published_html = ?, published_css = ?, published_at = ? WHERE restaurant_id = ?').run(html, page.css, now(), rid);
    db.prepare('INSERT INTO page_versions VALUES (?, ?, ?, ?, ?, ?)').run(randomUUID(), rid, JSON.stringify(page.projectData), html, page.css, now());
    return { publishedAt: now(), publicUrl: 'http://127.0.0.1:5175/' + restaurant(db, rid).slug };
  });
}
export function reports(db, rid) {
  const allTables = tables(db, rid); const orders = listOrders(db, rid);
  const firstTimes = queryAll(db, 'SELECT (julianday(first_service_at) - julianday(opened_at)) * 86400 AS seconds FROM table_visits WHERE restaurant_id = ? AND first_service_at IS NOT NULL', rid);
  return { tables: allTables.length, occupied: allTables.filter(t => t.status !== 'free').length, activeOrders: orders.filter(o => !['paid', 'cancelled'].includes(o.status)).length, paidOrders: orders.filter(o => o.status === 'paid').length, revenueCents: orders.filter(o => o.status === 'paid').reduce((n, o) => n + o.totalCents, 0), averageFirstServiceSeconds: firstTimes.length ? Math.round(firstTimes.reduce((n, r) => n + Math.max(0, r.seconds), 0) / firstTimes.length) : null, reservations: reservations(db, rid).length, alerts: db.prepare('SELECT count(*) AS count FROM vision_events WHERE restaurant_id = ? AND acknowledged_at IS NULL AND event_type = ?').get(rid, 'table_unattended').count };
}
