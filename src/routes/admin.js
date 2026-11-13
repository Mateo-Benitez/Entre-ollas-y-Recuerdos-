'use strict';
const express = require('express');
const { db, getSettings, setSettings } = require('../db');
const auth = require('../auth');
const { upload, saveImage, deleteImage } = require('../lib/images');
const { normalizeWhatsapp, isValidWhatsapp } = require('../lib/order');
const { getCurrentMenu } = require('../lib/menu');
const { now } = require('../lib/time');

const router = express.Router();

const bad = (msg) => Object.assign(new Error(msg), { status: 400 });
const notFound = (msg = 'No encontrado.') => Object.assign(new Error(msg), { status: 404 });
const str = (v, max, { required = false, label = 'Campo' } = {}) => {
  const s = String(v ?? '').trim();
  if (required && !s) throw bad(`${label} es obligatorio.`);
  if (s.length > max) throw bad(`${label} es demasiado largo (máx. ${max} caracteres).`);
  return s;
};
const int = (v, { min = 0, max = 1e9, label = 'Valor' } = {}) => {
  const n = Number(String(v ?? '').replace(/[.\s$]/g, '').replace(',', '.'));
  if (!Number.isFinite(n) || n < min || n > max) throw bad(`${label} inválido.`);
  return Math.round(n);
};
const bool = (v) => v === true || v === 1 || v === '1' || v === 'true' || v === 'on';
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
const id = (v) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) throw notFound();
  return n;
};

// ---------------------------------------------------------------- Autenticación
router.post('/login', async (req, res) => {
  const username = String(req.body?.username || '').trim().toLowerCase();
  const key = `${req.ip}|${username}`;
  if (auth.loginBlocked(key)) {
    return res.status(429).json({ error: 'Demasiados intentos fallidos. Esperá 15 minutos.' });
  }
  const admin = await auth.login(username, req.body?.password);
  if (!admin) {
    auth.registerFail(key);
    return res.status(401).json({ error: 'Usuario o contraseña incorrectos.' });
  }
  auth.clearFails(key);
  auth.createSession(res, admin.id);
  res.json({ ok: true, username: admin.username });
});

router.post('/logout', (req, res) => {
  auth.destroySession(req, res);
  res.json({ ok: true });
});

// Todo lo que sigue requiere sesión
router.use(auth.requireAdmin);

router.get('/me', (req, res) => res.json(req.admin));

router.post('/password', async (req, res) => {
  const row = db.prepare('SELECT password_hash FROM admins WHERE id = ?').get(req.admin.id);
  const ok = await auth.bcrypt.compare(String(req.body?.current || ''), row.password_hash);
  if (!ok) throw bad('La contraseña actual no es correcta.');
  await auth.changePassword(req.admin.id, req.body?.password);
  res.json({ ok: true });
});

// ---------------------------------------------------------------- Resumen
router.get('/dashboard', (req, res) => {
  const menu = getCurrentMenu();
  res.json({
    today: now().date,
    current_menu: menu || null,
    counts: {
      products: db.prepare('SELECT COUNT(*) n FROM products').get().n,
      sold_out: db.prepare('SELECT COUNT(*) n FROM products WHERE available = 0').get().n,
      menus: db.prepare('SELECT COUNT(*) n FROM weekly_menus').get().n,
      menu_items: menu ? db.prepare('SELECT COUNT(*) n FROM menu_items WHERE menu_id = ?').get(menu.id).n : 0,
      orders_week: db.prepare("SELECT COUNT(*) n FROM orders WHERE status != 'generado' AND created_at >= datetime('now','-7 days')").get().n,
    },
    whatsapp_ok: isValidWhatsapp(normalizeWhatsapp(getSettings().whatsapp)),
  });
});

// ---------------------------------------------------------------- Categorías
router.get('/categories', (req, res) => {
  res.json(db.prepare(`
    SELECT c.*, (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id) AS product_count
    FROM categories c ORDER BY sort_order, name
  `).all());
});

router.post('/categories', (req, res) => {
  const name = str(req.body?.name, 60, { required: true, label: 'El nombre' });
  const max = db.prepare('SELECT COALESCE(MAX(sort_order), 0) m FROM categories').get().m;
  try {
    const r = db.prepare('INSERT INTO categories (name, sort_order) VALUES (?, ?)').run(name, max + 1);
    res.status(201).json({ id: r.lastInsertRowid });
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) throw bad('Ya existe una categoría con ese nombre.');
    throw e;
  }
});

router.put('/categories/:id', (req, res) => {
  const name = str(req.body?.name, 60, { required: true, label: 'El nombre' });
  try {
    const r = db.prepare('UPDATE categories SET name = ? WHERE id = ?').run(name, id(req.params.id));
    if (!r.changes) throw notFound();
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) throw bad('Ya existe una categoría con ese nombre.');
    throw e;
  }
  res.json({ ok: true });
});

router.put('/categories-order', (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number) : [];
  const upd = db.prepare('UPDATE categories SET sort_order = ? WHERE id = ?');
  db.transaction(() => ids.forEach((cid, i) => upd.run(i + 1, cid)))();
  res.json({ ok: true });
});

router.delete('/categories/:id', (req, res) => {
  const r = db.prepare('DELETE FROM categories WHERE id = ?').run(id(req.params.id));
  if (!r.changes) throw notFound();
  res.json({ ok: true });
});

// ---------------------------------------------------------------- Viandas / productos
router.get('/products', (req, res) => {
  res.json(db.prepare(`
    SELECT p.*, c.name AS category_name FROM products p
    LEFT JOIN categories c ON c.id = p.category_id
    ORDER BY COALESCE(c.sort_order, 9999), p.name
  `).all());
});

function productFields(body) {
  const categoryId = body.category_id ? Number(body.category_id) : null;
  if (categoryId && !db.prepare('SELECT 1 FROM categories WHERE id = ?').get(categoryId)) throw bad('La categoría no existe.');
  return {
    name: str(body.name, 100, { required: true, label: 'El nombre' }),
    description: str(body.description, 600, { label: 'La descripción' }),
    ingredients: str(body.ingredients, 600, { label: 'Los ingredientes' }),
    price: int(body.price, { min: 0, max: 100000000, label: 'Precio' }),
    category_id: categoryId,
    available: body.available === undefined ? 1 : bool(body.available) ? 1 : 0,
  };
}

router.post('/products', upload.single('image'), async (req, res) => {
  const f = productFields(req.body || {});
  f.image = req.file ? await saveImage(req.file.buffer, { prefix: 'plato' }) : null;
  const r = db.prepare(`
    INSERT INTO products (name, description, ingredients, price, category_id, available, image)
    VALUES (@name, @description, @ingredients, @price, @category_id, @available, @image)
  `).run(f);
  res.status(201).json({ id: r.lastInsertRowid });
});

router.put('/products/:id', upload.single('image'), async (req, res) => {
  const pid = id(req.params.id);
  const prev = db.prepare('SELECT * FROM products WHERE id = ?').get(pid);
  if (!prev) throw notFound('El plato no existe.');
  const f = productFields(req.body || {});
  f.image = prev.image;
  if (req.file) f.image = await saveImage(req.file.buffer, { prefix: 'plato' });
  else if (bool(req.body?.remove_image)) f.image = null;
  db.prepare(`
    UPDATE products SET name=@name, description=@description, ingredients=@ingredients, price=@price,
      category_id=@category_id, available=@available, image=@image, updated_at=datetime('now')
    WHERE id=@id
  `).run({ ...f, id: pid });
  if (prev.image && prev.image !== f.image) deleteImage(prev.image);
  res.json({ ok: true });
});

// Cambio rápido de disponibilidad o precio (desde listados)
router.patch('/products/:id', (req, res) => {
  const pid = id(req.params.id);
  const sets = [];
  const params = { id: pid };
  if ('available' in (req.body || {})) { sets.push('available = @available'); params.available = bool(req.body.available) ? 1 : 0; }
  if ('price' in (req.body || {})) { sets.push('price = @price'); params.price = int(req.body.price, { label: 'Precio', max: 100000000 }); }
  if (!sets.length) throw bad('Nada para actualizar.');
  const r = db.prepare(`UPDATE products SET ${sets.join(', ')}, updated_at = datetime('now') WHERE id = @id`).run(params);
  if (!r.changes) throw notFound();
  res.json({ ok: true });
});

router.delete('/products/:id', (req, res) => {
  const pid = id(req.params.id);
  const prev = db.prepare('SELECT image FROM products WHERE id = ?').get(pid);
  if (!prev) throw notFound();
  db.prepare('DELETE FROM products WHERE id = ?').run(pid);
  deleteImage(prev.image);
  res.json({ ok: true });
});

// ---------------------------------------------------------------- Menús semanales
function menuFields(body) {
  const start = str(body.start_date, 10) || null;
  const end = str(body.end_date, 10) || null;
  if (start && !isDate(start)) throw bad('Fecha de inicio inválida.');
  if (end && !isDate(end)) throw bad('Fecha de fin inválida.');
  if (start && end && end < start) throw bad('La fecha de fin no puede ser anterior a la de inicio.');
  return {
    title: str(body.title, 80, { required: true, label: 'El nombre del menú' }),
    start_date: start, end_date: end,
    notes: str(body.notes, 400, { label: 'La nota' }),
    active: bool(body.active) ? 1 : 0,
  };
}

router.get('/menus', (req, res) => {
  const current = getCurrentMenu();
  const menus = db.prepare(`
    SELECT m.*, (SELECT COUNT(*) FROM menu_items mi WHERE mi.menu_id = m.id) AS item_count
    FROM weekly_menus m ORDER BY COALESCE(m.start_date, m.created_at) DESC, m.id DESC
  `).all();
  res.json(menus.map((m) => ({ ...m, is_current: !!current && current.id === m.id })));
});

router.get('/menus/:id', (req, res) => {
  const mid = id(req.params.id);
  const menu = db.prepare('SELECT * FROM weekly_menus WHERE id = ?').get(mid);
  if (!menu) throw notFound('El menú no existe.');
  const items = db.prepare('SELECT product_id, day, sort_order FROM menu_items WHERE menu_id = ? ORDER BY day, sort_order').all(mid);
  const current = getCurrentMenu();
  res.json({ ...menu, items, is_current: !!current && current.id === mid });
});

router.post('/menus', (req, res) => {
  const f = menuFields(req.body || {});
  const r = db.prepare(`
    INSERT INTO weekly_menus (title, start_date, end_date, notes, active)
    VALUES (@title, @start_date, @end_date, @notes, @active)
  `).run(f);
  res.status(201).json({ id: r.lastInsertRowid });
});

router.put('/menus/:id', (req, res) => {
  const f = menuFields(req.body || {});
  const r = db.prepare(`
    UPDATE weekly_menus SET title=@title, start_date=@start_date, end_date=@end_date, notes=@notes,
      active=@active, updated_at=datetime('now') WHERE id=@id
  `).run({ ...f, id: id(req.params.id) });
  if (!r.changes) throw notFound();
  res.json({ ok: true });
});

router.patch('/menus/:id', (req, res) => {
  if (!('active' in (req.body || {}))) throw bad('Nada para actualizar.');
  const r = db.prepare("UPDATE weekly_menus SET active = ?, updated_at = datetime('now') WHERE id = ?")
    .run(bool(req.body.active) ? 1 : 0, id(req.params.id));
  if (!r.changes) throw notFound();
  res.json({ ok: true });
});

// Reemplaza todos los platos del menú: [{ product_id, day }]
router.put('/menus/:id/items', (req, res) => {
  const mid = id(req.params.id);
  if (!db.prepare('SELECT 1 FROM weekly_menus WHERE id = ?').get(mid)) throw notFound('El menú no existe.');
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  if (items.length > 2000) throw bad('Demasiados platos.');
  const exists = db.prepare('SELECT 1 FROM products WHERE id = ?');
  const ins = db.prepare('INSERT OR IGNORE INTO menu_items (menu_id, product_id, day, sort_order) VALUES (?, ?, ?, ?)');
  db.transaction(() => {
    db.prepare('DELETE FROM menu_items WHERE menu_id = ?').run(mid);
    items.forEach((it, i) => {
      const pid = Number(it.product_id);
      const day = Number(it.day);
      if (!Number.isInteger(day) || day < 0 || day > 7) throw bad('Día inválido.');
      if (!exists.get(pid)) throw bad('Uno de los platos no existe.');
      ins.run(mid, pid, day, i);
    });
    db.prepare("UPDATE weekly_menus SET updated_at = datetime('now') WHERE id = ?").run(mid);
  })();
  res.json({ ok: true });
});

// Duplica un menú (ideal para armar la semana siguiente en segundos)
router.post('/menus/:id/duplicate', (req, res) => {
  const mid = id(req.params.id);
  const src = db.prepare('SELECT * FROM weekly_menus WHERE id = ?').get(mid);
  if (!src) throw notFound('El menú no existe.');
  const shift = (d) => {
    if (!d) return null;
    const dt = new Date(d + 'T12:00:00Z');
    dt.setUTCDate(dt.getUTCDate() + 7);
    return dt.toISOString().slice(0, 10);
  };
  const newId = db.transaction(() => {
    const r = db.prepare(`
      INSERT INTO weekly_menus (title, start_date, end_date, notes, active) VALUES (?, ?, ?, ?, 0)
    `).run(`${src.title} (copia)`.slice(0, 80), shift(src.start_date), shift(src.end_date), src.notes);
    db.prepare(`
      INSERT INTO menu_items (menu_id, product_id, day, sort_order)
      SELECT ?, product_id, day, sort_order FROM menu_items WHERE menu_id = ?
    `).run(r.lastInsertRowid, mid);
    return r.lastInsertRowid;
  })();
  res.status(201).json({ id: newId });
});

router.delete('/menus/:id', (req, res) => {
  const r = db.prepare('DELETE FROM weekly_menus WHERE id = ?').run(id(req.params.id));
  if (!r.changes) throw notFound();
  res.json({ ok: true });
});

// ---------------------------------------------------------------- Zonas de entrega
router.get('/zones', (req, res) => res.json(db.prepare('SELECT * FROM delivery_zones ORDER BY sort_order, name').all()));

function zoneFields(b) {
  return {
    name: str(b.name, 80, { required: true, label: 'El nombre de la zona' }),
    cost: int(b.cost, { label: 'Costo de envío', max: 10000000 }),
    active: b.active === undefined ? 1 : bool(b.active) ? 1 : 0,
  };
}
router.post('/zones', (req, res) => {
  const f = zoneFields(req.body || {});
  f.sort_order = db.prepare('SELECT COALESCE(MAX(sort_order),0)+1 m FROM delivery_zones').get().m;
  const r = db.prepare('INSERT INTO delivery_zones (name, cost, active, sort_order) VALUES (@name, @cost, @active, @sort_order)').run(f);
  res.status(201).json({ id: r.lastInsertRowid });
});
router.put('/zones/:id', (req, res) => {
  const r = db.prepare('UPDATE delivery_zones SET name=@name, cost=@cost, active=@active WHERE id=@id')
    .run({ ...zoneFields(req.body || {}), id: id(req.params.id) });
  if (!r.changes) throw notFound();
  res.json({ ok: true });
});
router.delete('/zones/:id', (req, res) => {
  const r = db.prepare('DELETE FROM delivery_zones WHERE id = ?').run(id(req.params.id));
  if (!r.changes) throw notFound();
  res.json({ ok: true });
});

// ---------------------------------------------------------------- Configuración del negocio
router.get('/settings', (req, res) => res.json(getSettings()));

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
router.put('/settings', (req, res) => {
  const b = req.body || {};
  const out = {};
  const text = { business_name: 80, slogan: 120, about: 1500, phone: 40, email: 120, instagram: 80, address: 200,
    hours_note: 300, pickup_address: 200, delivery_info: 600, pickup_info: 600 };
  for (const [k, max] of Object.entries(text)) if (k in b) out[k] = str(b[k], max, { label: 'Un campo' });
  if ('business_name' in out && !out.business_name) throw bad('El nombre del negocio es obligatorio.');
  if ('email' in out && out.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(out.email)) throw bad('El email no es válido.');
  if ('instagram' in out) out.instagram = out.instagram.replace(/^@/, '').replace(/^https?:\/\/(www\.)?instagram\.com\//, '').replace(/\/.*$/, '');

  if ('whatsapp' in b) {
    const wa = normalizeWhatsapp(b.whatsapp);
    if (wa && !isValidWhatsapp(wa)) throw bad('El número de WhatsApp debe tener entre 8 y 15 dígitos, con código de país (ej: 5491112345678).');
    out.whatsapp = wa;
  }
  for (const k of ['orders_enabled', 'accept_orders_when_closed', 'delivery_enabled', 'pickup_enabled']) if (k in b) out[k] = bool(b[k]);
  if ('min_order' in b) out.min_order = int(b.min_order || 0, { label: 'Pedido mínimo', max: 100000000 });

  if ('business_hours' in b) {
    if (!Array.isArray(b.business_hours)) throw bad('Horarios inválidos.');
    out.business_hours = [1, 2, 3, 4, 5, 6, 7].map((d) => {
      const h = b.business_hours.find((x) => Number(x.day) === d) || {};
      const open = TIME.test(h.open) ? h.open : '09:00';
      const close = TIME.test(h.close) ? h.close : '18:00';
      if (bool(h.enabled) && close <= open) throw bad('En los horarios, la hora de cierre debe ser posterior a la de apertura.');
      return { day: d, enabled: bool(h.enabled), open, close };
    });
  }
  if ('service_days' in b) {
    if (!Array.isArray(b.service_days)) throw bad('Días inválidos.');
    out.service_days = [...new Set(b.service_days.map(Number).filter((d) => d >= 1 && d <= 7))].sort();
  }
  if ('payment_methods' in b) {
    if (!Array.isArray(b.payment_methods)) throw bad('Formas de pago inválidas.');
    out.payment_methods = [...new Set(b.payment_methods.map((x) => str(x, 40)).filter(Boolean))].slice(0, 10);
  }
  const merged = { ...getSettings(), ...out };
  if (!merged.delivery_enabled && !merged.pickup_enabled) throw bad('Tiene que haber al menos una forma de entrega habilitada (envío o retiro).');
  setSettings(out);
  res.json(getSettings());
});

// Logo e imagen principal
router.post('/settings/image/:key', upload.single('image'), async (req, res) => {
  const key = req.params.key;
  if (!['logo', 'hero_image'].includes(key)) throw notFound();
  if (!req.file) throw bad('Elegí una imagen.');
  const opts = key === 'logo' ? { maxWidth: 400, maxHeight: 400, prefix: 'logo' } : { maxWidth: 1920, maxHeight: 1280, prefix: 'portada' };
  const url = await saveImage(req.file.buffer, opts);
  const prev = getSettings()[key];
  setSettings({ [key]: url });
  deleteImage(prev);
  res.json({ url });
});
router.delete('/settings/image/:key', (req, res) => {
  const key = req.params.key;
  if (!['logo', 'hero_image'].includes(key)) throw notFound();
  const prev = getSettings()[key];
  setSettings({ [key]: null });
  deleteImage(prev);
  res.json({ ok: true });
});

// ---------------------------------------------------------------- Pedidos recibidos
const STATUSES = ['generado', 'enviado', 'confirmado', 'entregado', 'cancelado'];
router.get('/orders', (req, res) => {
  const status = String(req.query.status || '');
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const rows = STATUSES.includes(status)
    ? db.prepare('SELECT * FROM orders WHERE status = ? ORDER BY id DESC LIMIT ?').all(status, limit)
    : db.prepare("SELECT * FROM orders WHERE status != 'generado' ORDER BY id DESC LIMIT ?").all(limit);
  res.json(rows.map((o) => ({ ...o, items: JSON.parse(o.items_json), items_json: undefined })));
});
router.patch('/orders/:id', (req, res) => {
  const status = String(req.body?.status || '');
  if (!STATUSES.includes(status)) throw bad('Estado inválido.');
  const r = db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(status, id(req.params.id));
  if (!r.changes) throw notFound();
  res.json({ ok: true });
});

// ---------------------------------------------------------------- Administradores
router.get('/admins', (req, res) => {
  res.json(db.prepare('SELECT id, username, created_at, last_login FROM admins ORDER BY id').all());
});
router.post('/admins', async (req, res) => {
  const newId = await auth.createAdmin(req.body?.username, req.body?.password);
  res.status(201).json({ id: newId });
});
router.delete('/admins/:id', (req, res) => {
  const aid = id(req.params.id);
  if (aid === req.admin.id) throw bad('No podés eliminar tu propio usuario.');
  if (db.prepare('SELECT COUNT(*) n FROM admins').get().n <= 1) throw bad('Tiene que quedar al menos un administrador.');
  const r = db.prepare('DELETE FROM admins WHERE id = ?').run(aid);
  if (!r.changes) throw notFound();
  res.json({ ok: true });
});

module.exports = router;
