'use strict';
/* Carga datos de ejemplo para probar la tienda:  npm run seed:demo
   Solo funciona con la base vacía (sin platos) para no pisar datos reales. */
const { db } = require('../src/db');
const { now } = require('../src/lib/time');

if (db.prepare('SELECT COUNT(*) n FROM products').get().n > 0) {
  console.log('La base ya tiene platos cargados. No se agregaron datos de ejemplo.');
  process.exit(0);
}

const cats = ['Platos principales', 'Tartas y empanadas', 'Ensaladas', 'Postres'];
const catId = {};
cats.forEach((c, i) => {
  catId[c] = db.prepare('INSERT OR IGNORE INTO categories (name, sort_order) VALUES (?, ?)').run(c, i + 1).lastInsertRowid
    || db.prepare('SELECT id FROM categories WHERE name = ?').get(c).id;
});

const products = [
  ['Milanesa con puré', 'Milanesa de carne casera con puré de papas cremoso.', 'Nalga, pan rallado, huevo, papa, manteca, leche', 9500, 'Platos principales'],
  ['Pollo al horno con papas', 'Cuarto de pollo dorado al horno con papas y romero.', 'Pollo, papa, romero, ajo, aceite de oliva', 8900, 'Platos principales'],
  ['Tallarines con tuco', 'Tallarines caseros con salsa de tomate y carne.', 'Harina, huevo, tomate, carne picada, cebolla, morrón', 8200, 'Platos principales'],
  ['Guiso de lentejas', 'Guiso bien casero, ideal para los días frescos.', 'Lentejas, chorizo colorado, panceta, zapallo, papa', 8500, 'Platos principales'],
  ['Pastel de papa', 'Carne picada condimentada cubierta con puré gratinado.', 'Carne picada, cebolla, huevo, aceitunas, papa, queso', 9200, 'Platos principales'],
  ['Tarta de jamón y queso', 'Porción grande de tarta con masa casera.', 'Harina, jamón cocido, queso, huevo, crema', 6500, 'Tartas y empanadas'],
  ['Tarta de verdura', 'Acelga, cebolla y queso, con masa casera.', 'Acelga, cebolla, huevo, queso, harina', 6200, 'Tartas y empanadas'],
  ['Empanadas de carne (x3)', 'Empanadas al horno, carne cortada a cuchillo.', 'Carne, cebolla de verdeo, huevo, aceitunas, comino', 5800, 'Tartas y empanadas'],
  ['Ensalada completa', 'Lechuga, tomate, zanahoria, huevo y choclo.', 'Lechuga, tomate, zanahoria, huevo, choclo', 5200, 'Ensaladas'],
  ['Flan casero con dulce de leche', 'El clásico de la abuela.', 'Huevo, leche, azúcar, dulce de leche', 3200, 'Postres'],
];
const insP = db.prepare('INSERT INTO products (name, description, ingredients, price, category_id) VALUES (?, ?, ?, ?, ?)');
const pid = {};
for (const [n, d, i, p, c] of products) pid[n] = insP.run(n, d, i, p, catId[c]).lastInsertRowid;

// Menú de esta semana (lunes a domingo actuales)
const t = now();
const base = new Date(t.date + 'T12:00:00Z');
base.setUTCDate(base.getUTCDate() - (t.weekday - 1));
const monday = base.toISOString().slice(0, 10);
base.setUTCDate(base.getUTCDate() + 6);
const sunday = base.toISOString().slice(0, 10);

const menuId = db.prepare('INSERT INTO weekly_menus (title, start_date, end_date, active, notes) VALUES (?, ?, ?, 1, ?)')
  .run('Menú de esta semana', monday, sunday, 'Hacé tu pedido con un día de anticipación.').lastInsertRowid;

const plan = {
  1: ['Milanesa con puré', 'Tarta de verdura'],
  2: ['Tallarines con tuco', 'Tarta de jamón y queso'],
  3: ['Guiso de lentejas', 'Pollo al horno con papas'],
  4: ['Pastel de papa', 'Tarta de verdura'],
  5: ['Milanesa con puré', 'Empanadas de carne (x3)'],
  0: ['Ensalada completa', 'Flan casero con dulce de leche'],
};
const insI = db.prepare('INSERT INTO menu_items (menu_id, product_id, day, sort_order) VALUES (?, ?, ?, ?)');
for (const [day, names] of Object.entries(plan)) names.forEach((n, i) => insI.run(menuId, pid[n], Number(day), i));

const insZ = db.prepare('INSERT INTO delivery_zones (name, cost, sort_order) VALUES (?, ?, ?)');
[['Centro', 1000], ['Barrios cercanos (hasta 3 km)', 1800], ['Zona alejada (hasta 6 km)', 2800]].forEach(([n, c], i) => insZ.run(n, c, i + 1));

console.log('✔ Datos de ejemplo cargados: 4 categorías, 10 platos, 1 menú semanal activo y 3 zonas de entrega.');
console.log('  Recordá configurar el número de WhatsApp desde el panel (Configuración).');
