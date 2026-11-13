'use strict';
const express = require('express');
const { db, getSettings } = require('../db');
const { getCurrentMenu, getMenuProducts } = require('../lib/menu');
const { openStatus, now, DAY_NAMES } = require('../lib/time');
const { buildOrder, saveOrder, normalizeWhatsapp, isValidWhatsapp } = require('../lib/order');
const rateLimit = require('../lib/rateLimit');

const router = express.Router();

// Claves de configuración que se pueden mostrar públicamente
const PUBLIC_KEYS = [
  'business_name', 'slogan', 'about', 'logo', 'hero_image', 'phone', 'email', 'instagram', 'address',
  'business_hours', 'hours_note', 'service_days', 'orders_enabled', 'accept_orders_when_closed',
  'delivery_enabled', 'pickup_enabled', 'pickup_address', 'delivery_info', 'pickup_info',
  'min_order', 'payment_methods',
];

router.get('/store', (req, res) => {
  const s = getSettings();
  const settings = Object.fromEntries(PUBLIC_KEYS.map((k) => [k, s[k]]));
  const wa = normalizeWhatsapp(s.whatsapp);
  settings.whatsapp = isValidWhatsapp(wa) ? wa : null;

  const menu = getCurrentMenu();
  const products = menu ? getMenuProducts(menu.id) : [];
  const categories = db.prepare('SELECT id, name, sort_order FROM categories ORDER BY sort_order, name').all();
  const zones = db.prepare('SELECT id, name, cost FROM delivery_zones WHERE active = 1 ORDER BY sort_order, name').all();
  const status = openStatus(s.business_hours);

  res.set('Cache-Control', 'no-store');
  res.json({
    settings,
    status: { is_open: status.isOpen, weekday: status.weekday, today: now().date },
    day_names: DAY_NAMES,
    menu: menu ? { id: menu.id, title: menu.title, start_date: menu.start_date, end_date: menu.end_date, notes: menu.notes } : null,
    products,
    categories,
    zones,
  });
});

// Crea el pedido (validado y calculado en el servidor) y devuelve el mensaje + enlace de WhatsApp
router.post('/orders', rateLimit({ windowMs: 10 * 60 * 1000, max: 30 }), (req, res) => {
  const order = buildOrder(req.body);
  saveOrder(order);
  res.json({
    code: order.code,
    lines: order.lines,
    subtotal: order.subtotal,
    delivery_cost: order.delivery_cost,
    total: order.total,
    customer: order.customer,
    message: order.message,
    whatsapp_url: order.whatsapp_url,
  });
});

// El cliente tocó "Finalizar pedido por WhatsApp"
router.post('/orders/:code/sent', rateLimit({ windowMs: 10 * 60 * 1000, max: 60 }), (req, res) => {
  const code = String(req.params.code || '').toUpperCase();
  if (/^[A-F0-9]{6}$/.test(code)) {
    db.prepare("UPDATE orders SET status = 'enviado' WHERE code = ? AND status = 'generado'").run(code);
  }
  res.status(204).end();
});

module.exports = router;
