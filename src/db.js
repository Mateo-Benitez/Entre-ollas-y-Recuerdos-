'use strict';
const fs = require('fs');
const Database = require('better-sqlite3');
const config = require('./config');

fs.mkdirSync(config.dataDir, { recursive: true });
fs.mkdirSync(config.uploadDir, { recursive: true });

const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

/*
 * Migraciones versionadas: para ampliar el proyecto en el futuro, agregar un nuevo
 * elemento al final del array (nunca modificar los anteriores).
 */
const migrations = [
  // 1 — estructura inicial
  `
  CREATE TABLE categories (
    id          INTEGER PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE COLLATE NOCASE,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE products (
    id           INTEGER PRIMARY KEY,
    name         TEXT NOT NULL,
    description  TEXT NOT NULL DEFAULT '',
    ingredients  TEXT NOT NULL DEFAULT '',
    price        INTEGER NOT NULL CHECK (price >= 0),
    image        TEXT,
    category_id  INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    available    INTEGER NOT NULL DEFAULT 1 CHECK (available IN (0,1)),
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_products_category ON products(category_id);

  CREATE TABLE weekly_menus (
    id          INTEGER PRIMARY KEY,
    title       TEXT NOT NULL,
    start_date  TEXT,            -- YYYY-MM-DD (opcional)
    end_date    TEXT,            -- YYYY-MM-DD (opcional)
    active      INTEGER NOT NULL DEFAULT 0 CHECK (active IN (0,1)),
    notes       TEXT NOT NULL DEFAULT '',
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- day: 0 = toda la semana, 1 = lunes ... 7 = domingo
  CREATE TABLE menu_items (
    id          INTEGER PRIMARY KEY,
    menu_id     INTEGER NOT NULL REFERENCES weekly_menus(id) ON DELETE CASCADE,
    product_id  INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    day         INTEGER NOT NULL CHECK (day BETWEEN 0 AND 7),
    sort_order  INTEGER NOT NULL DEFAULT 0,
    UNIQUE (menu_id, product_id, day)
  );
  CREATE INDEX idx_menu_items_menu ON menu_items(menu_id);

  CREATE TABLE delivery_zones (
    id          INTEGER PRIMARY KEY,
    name        TEXT NOT NULL,
    cost        INTEGER NOT NULL DEFAULT 0 CHECK (cost >= 0),
    sort_order  INTEGER NOT NULL DEFAULT 0,
    active      INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1))
  );

  CREATE TABLE settings (
    key    TEXT PRIMARY KEY,
    value  TEXT NOT NULL         -- JSON
  );

  CREATE TABLE admins (
    id             INTEGER PRIMARY KEY,
    username       TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash  TEXT NOT NULL,
    created_at     TEXT NOT NULL DEFAULT (datetime('now')),
    last_login     TEXT
  );

  CREATE TABLE sessions (
    token_hash  TEXT PRIMARY KEY,
    admin_id    INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
    expires_at  INTEGER NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE orders (
    id               INTEGER PRIMARY KEY,
    code             TEXT NOT NULL UNIQUE,
    customer_name    TEXT NOT NULL,
    address          TEXT NOT NULL DEFAULT '',
    delivery_method  TEXT NOT NULL,       -- 'envio' | 'retiro'
    zone_name        TEXT NOT NULL DEFAULT '',
    payment_method   TEXT NOT NULL DEFAULT '',
    notes            TEXT NOT NULL DEFAULT '',
    items_json       TEXT NOT NULL,
    subtotal         INTEGER NOT NULL,
    delivery_cost    INTEGER NOT NULL DEFAULT 0,
    total            INTEGER NOT NULL,
    message          TEXT NOT NULL,
    status           TEXT NOT NULL DEFAULT 'generado', -- generado | enviado | confirmado | entregado | cancelado
    created_at       TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_orders_created ON orders(created_at);
  `,
];

db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)');
const row = db.prepare('SELECT version FROM schema_version').get();
let current = row ? row.version : 0;
if (!row) db.prepare('INSERT INTO schema_version (version) VALUES (0)').run();

for (let i = current; i < migrations.length; i++) {
  db.transaction(() => {
    db.exec(migrations[i]);
    db.prepare('UPDATE schema_version SET version = ?').run(i + 1);
  })();
}

// Configuración por defecto (solo se insertan las claves que no existan)
const DEFAULT_SETTINGS = {
  business_name: 'Entre ollas y recuerdos',
  slogan: 'Comida casera, rica y lista para disfrutar',
  about:
    'Somos un emprendimiento familiar que cocina todos los días con ingredientes frescos y recetas de siempre. Elegí tus viandas de la semana y te las llevamos a tu casa o pasás a retirarlas.',
  logo: null,
  hero_image: null,
  whatsapp: '', // Solo dígitos, con código de país. Ej: 5491112345678
  phone: '',
  email: '',
  instagram: '',
  address: '',
  // Horarios por día. day: 1 = lunes ... 7 = domingo
  business_hours: [
    { day: 1, enabled: true, open: '09:00', close: '18:00' },
    { day: 2, enabled: true, open: '09:00', close: '18:00' },
    { day: 3, enabled: true, open: '09:00', close: '18:00' },
    { day: 4, enabled: true, open: '09:00', close: '18:00' },
    { day: 5, enabled: true, open: '09:00', close: '18:00' },
    { day: 6, enabled: false, open: '09:00', close: '13:00' },
    { day: 7, enabled: false, open: '09:00', close: '13:00' },
  ],
  hours_note: '',
  service_days: [1, 2, 3, 4, 5], // días en los que se ofrecen viandas
  orders_enabled: true,           // pausa general de pedidos
  accept_orders_when_closed: true,
  delivery_enabled: true,
  pickup_enabled: true,
  pickup_address: '',
  delivery_info: 'Los envíos se realizan de lunes a viernes entre las 11 y las 14 hs.',
  pickup_info: 'Podés retirar tu pedido en nuestro local en el horario de atención.',
  min_order: 0,
  payment_methods: ['Efectivo', 'Transferencia', 'Mercado Pago'],
};

const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
db.transaction(() => {
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) insertSetting.run(k, JSON.stringify(v));
})();

function getSettings() {
  const out = {};
  for (const r of db.prepare('SELECT key, value FROM settings').all()) {
    try { out[r.key] = JSON.parse(r.value); } catch { out[r.key] = r.value; }
  }
  return out;
}

const upsertSetting = db.prepare(
  'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
);
function setSettings(obj) {
  db.transaction(() => {
    for (const [k, v] of Object.entries(obj)) upsertSetting.run(k, JSON.stringify(v));
  })();
}

module.exports = { db, getSettings, setSettings, DEFAULT_SETTINGS };
