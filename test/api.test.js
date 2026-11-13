'use strict';
/* Pruebas de integración de la API:  npm test  */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'viandas-test-'));
const PORT = 3000 + Math.floor(Math.random() * 2000) + 1000;
const BASE = `http://127.0.0.1:${PORT}`;
const env = { ...process.env, DATA_DIR, PORT: String(PORT), NODE_ENV: 'test', ADMIN_USER: '', ADMIN_PASSWORD: '' };
let server;
let cookie = '';

const json = (method, url, body, headers = {}) => fetch(BASE + url, {
  method,
  headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...headers },
  body: body === undefined ? undefined : JSON.stringify(body),
});
const admin = (method, url, body) => json(method, '/api/admin' + url, body, { 'X-Requested-With': 'fetch' });

before(async () => {
  execFileSync('node', ['scripts/seed-demo.js'], { cwd: ROOT, env });
  execFileSync('node', ['scripts/create-admin.js', 'dueno', 'clave-segura-123'], { cwd: ROOT, env });
  server = spawn('node', ['src/server.js'], { cwd: ROOT, env, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) {
    try { await fetch(BASE + '/api/store'); return; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }
  throw new Error('El servidor no arrancó');
});
after(() => { server?.kill(); fs.rmSync(DATA_DIR, { recursive: true, force: true }); });

const orderBody = (items, customer = {}) => ({
  items,
  customer: { name: 'Ana Gómez', delivery_method: 'retiro', payment_method: 'Efectivo', ...customer },
});

test('la tienda pública responde con menú vigente y sin número de WhatsApp inventado', async () => {
  const r = await json('GET', '/api/store');
  const d = await r.json();
  assert.equal(r.status, 200);
  assert.ok(d.menu, 'hay menú vigente');
  assert.ok(d.products.length > 0);
  assert.equal(d.settings.whatsapp, null);
});

test('no se aceptan pedidos si no hay WhatsApp configurado', async () => {
  const r = await json('POST', '/api/orders', orderBody([{ product_id: 1, day: 1, qty: 1 }]));
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /WhatsApp/);
});

test('el panel exige autenticación', async () => {
  assert.equal((await json('GET', '/api/admin/products')).status, 401);
  const page = await fetch(BASE + '/admin', { redirect: 'manual' });
  assert.equal(page.status, 302);
});

test('login incorrecto y correcto', async () => {
  const bad = await json('POST', '/api/admin/login', { username: 'dueno', password: 'otra' });
  assert.equal(bad.status, 401);
  const ok = await json('POST', '/api/admin/login', { username: 'dueno', password: 'clave-segura-123' });
  assert.equal(ok.status, 200);
  cookie = ok.headers.get('set-cookie').split(';')[0];
  assert.match(ok.headers.get('set-cookie'), /HttpOnly/i);
});

test('las modificaciones sin header propio se rechazan (CSRF)', async () => {
  const r = await json('PUT', '/api/admin/settings', { whatsapp: '5491100000000' });
  assert.equal(r.status, 403);
});

test('valida el número de WhatsApp y lo normaliza', async () => {
  assert.equal((await admin('PUT', '/settings', { whatsapp: '123' })).status, 400);
  const r = await admin('PUT', '/settings', { whatsapp: '+54 9 11 5555-0000' });
  assert.equal((await r.json()).whatsapp, '5491155550000');
});

test('el pedido se calcula en el servidor e ignora precios enviados por el cliente', async () => {
  const store = await (await json('GET', '/api/store')).json();
  const p = store.products.find((x) => x.days.includes(1));
  const zone = store.zones[0];
  const r = await json('POST', '/api/orders', orderBody(
    [{ product_id: p.id, day: 1, qty: 3, price: 1 }],
    { delivery_method: 'envio', address: 'Calle Falsa 123', zone_id: zone.id },
  ));
  const d = await r.json();
  assert.equal(r.status, 200, d.error);
  assert.equal(d.subtotal, p.price * 3);
  assert.equal(d.total, p.price * 3 + zone.cost);
  assert.match(d.whatsapp_url, /^https:\/\/wa\.me\/5491155550000\?text=/);
  assert.match(d.message, new RegExp(`3x ${p.name}`));
  assert.match(d.message, /Nombre: Ana Gómez/);
  assert.match(d.message, /Total: \$/);
});

test('no permite pedir productos agotados', async () => {
  const store = await (await json('GET', '/api/store')).json();
  const p = store.products.find((x) => x.days.includes(1));
  await admin('PATCH', `/products/${p.id}`, { available: false });
  const r = await json('POST', '/api/orders', orderBody([{ product_id: p.id, day: 1, qty: 1 }]));
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /agotado/);
  await admin('PATCH', `/products/${p.id}`, { available: true });
});

test('rechaza cantidades inválidas, día incorrecto y datos faltantes', async () => {
  const store = await (await json('GET', '/api/store')).json();
  const p = store.products.find((x) => x.days.includes(1) && !x.days.includes(6));
  for (const qty of [0, -1, 1.5, 999]) {
    assert.equal((await json('POST', '/api/orders', orderBody([{ product_id: p.id, day: 1, qty }]))).status, 400);
  }
  assert.equal((await json('POST', '/api/orders', orderBody([{ product_id: p.id, day: 6, qty: 1 }]))).status, 400);
  assert.equal((await json('POST', '/api/orders', orderBody([{ product_id: p.id, day: 1, qty: 1 }], { name: '' }))).status, 400);
  const noAddr = await json('POST', '/api/orders', orderBody([{ product_id: p.id, day: 1, qty: 1 }], { delivery_method: 'envio', zone_id: store.zones[0].id }));
  assert.equal((await noAddr.json()).field, 'address');
});

test('CRUD de viandas y menú semanal se refleja en la tienda', async () => {
  const fd = new FormData();
  fd.append('name', 'Ñoquis caseros');
  fd.append('price', '7.800');
  const created = await fetch(BASE + '/api/admin/products', { method: 'POST', body: fd, headers: { Cookie: cookie, 'X-Requested-With': 'fetch' } });
  assert.equal(created.status, 201);
  const { id } = await created.json();

  const menus = await (await admin('GET', '/menus')).json();
  const current = menus.find((m) => m.is_current);
  const detail = await (await admin('GET', `/menus/${current.id}`)).json();
  const items = [...detail.items.map(({ product_id, day }) => ({ product_id, day })), { product_id: id, day: 3 }];
  assert.equal((await admin('PUT', `/menus/${current.id}/items`, { items })).status, 200);

  const store = await (await json('GET', '/api/store')).json();
  const p = store.products.find((x) => x.id === id);
  assert.ok(p, 'la vianda nueva aparece en la tienda');
  assert.equal(p.price, 7800);
  assert.deepEqual(p.days, [3]);
});

test('duplicar menú lo crea inactivo con fechas corridas una semana', async () => {
  const menus = await (await admin('GET', '/menus')).json();
  const src = menus.find((m) => m.is_current);
  const { id } = await (await admin('POST', `/menus/${src.id}/duplicate`)).json();
  const copy = await (await admin('GET', `/menus/${id}`)).json();
  assert.equal(copy.active, 0);
  assert.equal(copy.items.length, (await (await admin('GET', `/menus/${src.id}`)).json()).items.length);
  const diff = (Date.parse(copy.start_date) - Date.parse(src.start_date)) / 864e5;
  assert.equal(diff, 7);
});

test('un menú programado a futuro no se muestra todavía', async () => {
  const future = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
  const r = await admin('POST', '/menus', { title: 'Futuro', start_date: future, active: true });
  assert.equal(r.status, 201);
  const store = await (await json('GET', '/api/store')).json();
  assert.notEqual(store.menu.title, 'Futuro');
});

test('rechaza archivos que no son imágenes', async () => {
  const fd = new FormData();
  fd.append('name', 'Malicioso');
  fd.append('price', '100');
  fd.append('image', new Blob(['<?php echo 1; ?>'], { type: 'image/png' }), 'x.png');
  const r = await fetch(BASE + '/api/admin/products', { method: 'POST', body: fd, headers: { Cookie: cookie, 'X-Requested-With': 'fetch' } });
  assert.equal(r.status, 400);
});

test('pausar pedidos bloquea nuevos pedidos', async () => {
  await admin('PUT', '/settings', { orders_enabled: false });
  const store = await (await json('GET', '/api/store')).json();
  const p = store.products.find((x) => x.days.includes(1));
  const r = await json('POST', '/api/orders', orderBody([{ product_id: p.id, day: 1, qty: 1 }]));
  assert.equal(r.status, 400);
  await admin('PUT', '/settings', { orders_enabled: true });
});

test('logout invalida la sesión', async () => {
  await admin('POST', '/logout');
  assert.equal((await admin('GET', '/me')).status, 401);
});
