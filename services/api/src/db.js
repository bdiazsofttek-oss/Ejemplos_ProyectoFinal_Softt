import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

const initialProject = {
  pages: [{ component: '<section class="hero"><h1>Casa Demo</h1><p>Sabores locales, servicio cercano.</p><a href="#menu">Ver menú</a></section><section id="menu"><h2>Especialidades</h2><p>Tacos de temporada · Ensalada de la casa · Postre del día</p></section>' }],
  styles: [{ selectors: ['body'], style: { margin: '0', 'font-family': 'system-ui, sans-serif', color: '#1f2937', 'background-color': '#fffaf0' } }, { selectors: ['.hero'], style: { padding: '80px 24px', 'text-align': 'center', 'background': 'linear-gradient(135deg, #f97316, #fb7185)', color: 'white' } }, { selectors: ['#menu'], style: { padding: '48px 24px', 'max-width': '760px', margin: '0 auto' } }]
};

export function openDatabase(filename = process.env.BETA_DB_PATH || resolve('data', 'beta.sqlite')) {
  if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS restaurants (
      id TEXT PRIMARY KEY, slug TEXT UNIQUE NOT NULL, name TEXT NOT NULL, city TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS restaurant_tables (
      id TEXT PRIMARY KEY, restaurant_id TEXT NOT NULL, label TEXT NOT NULL,
      seats INTEGER NOT NULL, status TEXT NOT NULL,
      FOREIGN KEY (restaurant_id) REFERENCES restaurants(id)
    );
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY, restaurant_id TEXT NOT NULL, table_id TEXT NOT NULL,
      item TEXT NOT NULL, quantity INTEGER NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL,
      FOREIGN KEY (restaurant_id) REFERENCES restaurants(id),
      FOREIGN KEY (table_id) REFERENCES restaurant_tables(id)
    );
    CREATE TABLE IF NOT EXISTS restaurant_pages (
      restaurant_id TEXT PRIMARY KEY, draft_json TEXT NOT NULL, draft_html TEXT NOT NULL,
      draft_css TEXT NOT NULL, published_html TEXT, published_css TEXT,
      updated_at TEXT NOT NULL, published_at TEXT,
      FOREIGN KEY (restaurant_id) REFERENCES restaurants(id)
    );
    CREATE TABLE IF NOT EXISTS vision_events (
      id TEXT PRIMARY KEY, restaurant_id TEXT NOT NULL, table_id TEXT,
      event_type TEXT NOT NULL, severity TEXT NOT NULL, source TEXT NOT NULL,
      payload_json TEXT NOT NULL, occurred_at TEXT NOT NULL,
      FOREIGN KEY (restaurant_id) REFERENCES restaurants(id)
    );
  `);
  seed(db);
  return db;
}

function seed(db) {
  db.prepare('INSERT OR IGNORE INTO restaurants (id, slug, name, city) VALUES (?, ?, ?, ?)').run('demo', 'casa-demo', 'Casa Demo', 'Ciudad de México');
  const insertTable = db.prepare('INSERT OR IGNORE INTO restaurant_tables (id, restaurant_id, label, seats, status) VALUES (?, ?, ?, ?, ?)');
  [['t1', 'Mesa 1', 2, 'free'], ['t2', 'Mesa 2', 4, 'occupied'], ['t3', 'Mesa 3', 4, 'waiting'], ['t4', 'Mesa 4', 6, 'free'], ['t5', 'Terraza 1', 2, 'bill'], ['t6', 'Terraza 2', 4, 'free']].forEach(([id, label, seats, status]) => insertTable.run(id, 'demo', label, seats, status));
  db.prepare(`INSERT OR IGNORE INTO restaurant_pages
    (restaurant_id, draft_json, draft_html, draft_css, updated_at)
    VALUES (?, ?, ?, ?, ?)`
  ).run('demo', JSON.stringify(initialProject), initialProject.pages[0].component, 'body{margin:0;font-family:system-ui,sans-serif}.hero{padding:80px 24px;text-align:center;background:linear-gradient(135deg,#f97316,#fb7185);color:#fff}#menu{padding:48px 24px;max-width:760px;margin:auto}', new Date().toISOString());
}

export function createOrder(db, restaurantId, { tableId, item, quantity = 1 }) {
  const table = db.prepare('SELECT id FROM restaurant_tables WHERE id = ? AND restaurant_id = ?').get(tableId, restaurantId);
  if (!table) throw new Error('Mesa no encontrada');
  const order = { id: randomUUID(), restaurantId, tableId, item: String(item || '').trim(), quantity: Number(quantity), status: 'new', createdAt: new Date().toISOString() };
  if (!order.item || !Number.isInteger(order.quantity) || order.quantity < 1) throw new Error('Pedido inválido');
  db.prepare('INSERT INTO orders (id, restaurant_id, table_id, item, quantity, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(order.id, restaurantId, tableId, order.item, order.quantity, order.status, order.createdAt);
  db.prepare("UPDATE restaurant_tables SET status = 'occupied' WHERE id = ? AND restaurant_id = ?").run(tableId, restaurantId);
  return order;
}

export function validatePageContent({ projectData, html, css }) {
  if (typeof html !== 'string' || typeof css !== 'string' || !projectData || typeof projectData !== 'object') throw new Error('Contenido de página inválido');
  if (html.length > 500_000 || css.length > 250_000 || JSON.stringify(projectData).length > 1_000_000) throw new Error('La página supera el tamaño permitido');
  const unsafeHtml = /<\s*(script|iframe|object|embed|link|meta|base)\b|\son[a-z]+\s*=|javascript\s*:/i;
  const unsafeCss = /@import\b|expression\s*\(|javascript\s*:|data\s*:\s*text\/html|<\s*\/?\s*(script|style|iframe)/i;
  if (unsafeHtml.test(html) || unsafeHtml.test(JSON.stringify(projectData)) || unsafeCss.test(css)) throw new Error('La página contiene código no permitido');
  return { projectData, html, css };
}
