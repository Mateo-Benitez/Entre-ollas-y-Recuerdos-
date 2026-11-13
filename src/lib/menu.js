'use strict';
const { db } = require('../db');
const { now } = require('./time');

/**
 * Devuelve el menú semanal vigente: activo y dentro de su rango de fechas (si tiene).
 * Si hay varios vigentes, gana el de fecha de inicio más reciente. Esto permite
 * "programar" un menú: se crea activo con fecha de inicio futura y aparece solo ese día.
 */
function getCurrentMenu(today = now().date) {
  return db.prepare(`
    SELECT * FROM weekly_menus
    WHERE active = 1
      AND (start_date IS NULL OR start_date = '' OR start_date <= @today)
      AND (end_date   IS NULL OR end_date   = '' OR end_date   >= @today)
    ORDER BY COALESCE(start_date, '') DESC, id DESC
    LIMIT 1
  `).get({ today });
}

/** Productos de un menú con sus días, para la vista pública. */
function getMenuProducts(menuId) {
  const rows = db.prepare(`
    SELECT p.id, p.name, p.description, p.ingredients, p.price, p.image, p.available,
           p.category_id, c.name AS category_name, c.sort_order AS category_order,
           mi.day, mi.sort_order
    FROM menu_items mi
    JOIN products p ON p.id = mi.product_id
    LEFT JOIN categories c ON c.id = p.category_id
    WHERE mi.menu_id = ?
    ORDER BY mi.day, COALESCE(c.sort_order, 9999), mi.sort_order, p.name
  `).all(menuId);

  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.id)) {
      map.set(r.id, {
        id: r.id, name: r.name, description: r.description, ingredients: r.ingredients,
        price: r.price, image: r.image, available: !!r.available,
        category_id: r.category_id, category_name: r.category_name || 'Otros',
        days: [],
      });
    }
    map.get(r.id).days.push(r.day);
  }
  return [...map.values()];
}

module.exports = { getCurrentMenu, getMenuProducts };
