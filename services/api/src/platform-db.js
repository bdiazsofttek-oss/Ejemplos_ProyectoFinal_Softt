import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';

export const now = () => new Date().toISOString();
export const digest = value => createHash('sha256').update(value).digest('hex');
export function passwordHash(password, salt = randomBytes(16).toString('hex')) {
  return salt + ':' + scryptSync(password, salt, 64).toString('hex');
}
export function passwordMatches(password, hash) {
  const [salt, key] = String(hash).split(':');
  const actual = Buffer.from(passwordHash(password, salt).split(':')[1], 'hex');
  const expected = Buffer.from(key || '', 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
export function fail(message, status = 400) { throw Object.assign(new Error(message), { status }); }
export function text(value, label, max = 200) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) fail(label + ' inválido');
  return value.trim();
}
export function integer(value, label, min = 0, max = 10000000) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) fail(label + ' inválido');
  return n;
}
export function email(value) {
  const result = text(value, 'Correo', 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result)) fail('Correo inválido');
  return result;
}
export function transaction(db, work) {
  db.exec('BEGIN IMMEDIATE');
  try { const value = work(); db.exec('COMMIT'); return value; }
  catch (error) { db.exec('ROLLBACK'); throw error; }
}

export function migratePlatform(db) {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)');
  if (!db.prepare('SELECT version FROM schema_migrations WHERE version = 2').get()) {
    transaction(db, () => {
      const columns = {
        restaurants: { cuisine: "TEXT NOT NULL DEFAULT 'Mexicana'", description: "TEXT NOT NULL DEFAULT ''", address: "TEXT NOT NULL DEFAULT ''", opening_time: "TEXT NOT NULL DEFAULT '09:00'", closing_time: "TEXT NOT NULL DEFAULT '23:00'", threshold_seconds: 'INTEGER NOT NULL DEFAULT 90', active: 'INTEGER NOT NULL DEFAULT 1' },
        restaurant_tables: { occupied_at: 'TEXT', last_service_at: 'TEXT', active: 'INTEGER NOT NULL DEFAULT 1' },
        orders: { notes: "TEXT NOT NULL DEFAULT ''", total_cents: 'INTEGER NOT NULL DEFAULT 0', updated_at: 'TEXT' },
        vision_events: { acknowledged_at: 'TEXT' }
      };
      for (const [table, additions] of Object.entries(columns)) {
        const existing = db.prepare('PRAGMA table_info(' + table + ')').all().map(c => c.name);
        for (const [name, type] of Object.entries(additions)) if (!existing.includes(name)) db.exec('ALTER TABLE ' + table + ' ADD COLUMN ' + name + ' ' + type);
      }
      db.exec("CREATE TABLE users (id TEXT PRIMARY KEY, restaurant_id TEXT REFERENCES restaurants(id), name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, role TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1); CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires_at TEXT NOT NULL); CREATE TABLE products (id TEXT PRIMARY KEY, restaurant_id TEXT NOT NULL REFERENCES restaurants(id), name TEXT NOT NULL, category TEXT NOT NULL, description TEXT NOT NULL, price_cents INTEGER NOT NULL CHECK(price_cents >= 0), active INTEGER NOT NULL DEFAULT 1); CREATE TABLE order_items (id TEXT PRIMARY KEY, restaurant_id TEXT NOT NULL REFERENCES restaurants(id), order_id TEXT NOT NULL REFERENCES orders(id), product_id TEXT REFERENCES products(id), name TEXT NOT NULL, quantity INTEGER NOT NULL CHECK(quantity > 0), price_cents INTEGER NOT NULL CHECK(price_cents >= 0)); CREATE TABLE reservations (id TEXT PRIMARY KEY, restaurant_id TEXT NOT NULL REFERENCES restaurants(id), table_id TEXT NOT NULL REFERENCES restaurant_tables(id), customer_id TEXT REFERENCES users(id), customer_name TEXT NOT NULL, email TEXT NOT NULL, guests INTEGER NOT NULL, starts_at TEXT NOT NULL, ends_at TEXT NOT NULL, status TEXT NOT NULL, secret TEXT NOT NULL, consent_at TEXT NOT NULL, created_at TEXT NOT NULL); CREATE INDEX reservations_slots ON reservations(restaurant_id, table_id, starts_at, ends_at, status); CREATE TABLE zones (id TEXT PRIMARY KEY, restaurant_id TEXT NOT NULL REFERENCES restaurants(id), table_id TEXT NOT NULL REFERENCES restaurant_tables(id), points_json TEXT NOT NULL, UNIQUE(restaurant_id, table_id)); CREATE TABLE table_visits (id TEXT PRIMARY KEY, restaurant_id TEXT NOT NULL REFERENCES restaurants(id), table_id TEXT NOT NULL REFERENCES restaurant_tables(id), opened_at TEXT NOT NULL, first_service_at TEXT, closed_at TEXT); CREATE UNIQUE INDEX one_open_visit ON table_visits(restaurant_id, table_id) WHERE closed_at IS NULL; CREATE TABLE page_versions (id TEXT PRIMARY KEY, restaurant_id TEXT NOT NULL REFERENCES restaurants(id), project_json TEXT NOT NULL, html TEXT NOT NULL, css TEXT NOT NULL, published_at TEXT NOT NULL); CREATE TABLE mail_outbox (id TEXT PRIMARY KEY, restaurant_id TEXT NOT NULL REFERENCES restaurants(id), recipient TEXT NOT NULL, subject TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL); CREATE TABLE vision_state (restaurant_id TEXT NOT NULL REFERENCES restaurants(id), table_id TEXT NOT NULL REFERENCES restaurant_tables(id), elapsed_seconds INTEGER NOT NULL DEFAULT 0, guests INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(restaurant_id, table_id));");
      const addUser = db.prepare('INSERT INTO users (id, restaurant_id, name, email, password_hash, role) VALUES (?, ?, ?, ?, ?, ?)');
      const hash = passwordHash('demo1234');
      for (const [id, tenant, name, address, role] of [
        ['u-admin', null, 'Administrador plataforma', 'plataforma@demo.local', 'platform_admin'],
        ['u-manager', 'demo', 'Gerente Demo', 'admin@demo.local', 'gerente'],
        ['u-waiter', 'demo', 'Mesero Demo', 'mesero@demo.local', 'mesero'],
        ['u-kitchen', 'demo', 'Cocina Demo', 'cocina@demo.local', 'cocina'],
        ['u-customer', null, 'Cliente Demo', 'cliente@demo.local', 'customer']
      ]) addUser.run(id, tenant, name, address, hash, role);
      const product = db.prepare('INSERT INTO products (id, restaurant_id, name, category, description, price_cents) VALUES (?, ?, ?, ?, ?, ?)');
      for (const [id, name, category, price] of [['p1', 'Tacos de temporada', 'Platillos', 12000], ['p2', 'Ensalada de la casa', 'Platillos', 9500], ['p3', 'Agua fresca', 'Bebidas', 3500], ['p4', 'Postre del día', 'Postres', 6500]]) product.run(id, 'demo', name, category, '', price);
      db.prepare('INSERT INTO schema_migrations VALUES (?, ?)').run(2, now());
    });
  }
}

export function sessionUser(db, authorization) {
  const token = String(authorization || '').replace(/^Bearer /, '');
  if (!token) return null;
  return db.prepare('SELECT u.id, u.name, u.email, u.role, u.restaurant_id AS restaurantId FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ? AND u.active = 1').get(digest(token), now()) || null;
}
export function makeSession(db, user) {
  const accessToken = randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions VALUES (?, ?, ?)').run(digest(accessToken), user.id, new Date(Date.now() + 12 * 3600000).toISOString());
  return { accessToken, user: { id: user.id, name: user.name, email: user.email, role: user.role, restaurantId: user.restaurant_id ?? null } };
}
