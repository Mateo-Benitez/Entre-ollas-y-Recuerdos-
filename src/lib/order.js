'use strict';
const crypto = require('crypto');
const { db, getSettings } = require('../db');
const { getCurrentMenu } = require('./menu');
const { DAY_NAMES, openStatus, now } = require('./time');

class ValidationError extends Error {
  constructor(message, field) { super(message); this.status = 400; this.field = field; }
}

const money = (n) => '$' + Math.round(n).toLocaleString('es-AR');
const clean = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const cleanMultiline = (v, max) => String(v ?? '').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '').trim().slice(0, max);

const MAX_QTY = 50;
const MAX_LINES = 60;

/** Normaliza un número de WhatsApp a solo dígitos (formato internacional para wa.me). */
function normalizeWhatsapp(raw) {
  return String(raw || '').replace(/\D/g, '');
}
function isValidWhatsapp(digits) {
  return /^\d{8,15}$/.test(digits);
}

/**
 * Valida un pedido del cliente contra la base de datos y calcula importes en el servidor.
 * Nunca se confía en precios o nombres enviados por el navegador.
 */
function buildOrder(payload) {
  const settings = getSettings();
  if (!settings.orders_enabled) throw new ValidationError('En este momento no estamos tomando pedidos.');

  const wa = normalizeWhatsapp(settings.whatsapp);
  if (!isValidWhatsapp(wa)) throw new ValidationError('El negocio todavía no configuró su número de WhatsApp.');

  if (!settings.accept_orders_when_closed && !openStatus(settings.business_hours).isOpen) {
    throw new ValidationError('Estamos cerrados en este momento. Revisá nuestros horarios de atención.');
  }

  const menu = getCurrentMenu();
  if (!menu) throw new ValidationError('No hay un menú disponible en este momento.');

  // --- Productos ---
  const items = Array.isArray(payload?.items) ? payload.items : [];
  if (items.length === 0) throw new ValidationError('El carrito está vacío.');
  if (items.length > MAX_LINES) throw new ValidationError('El pedido tiene demasiados productos.');

  const findItem = db.prepare(`
    SELECT p.id, p.name, p.price, p.available
    FROM menu_items mi JOIN products p ON p.id = mi.product_id
    WHERE mi.menu_id = ? AND mi.product_id = ? AND mi.day = ?
  `);

  const merged = new Map();
  for (const it of items) {
    const productId = Number(it?.product_id);
    const day = Number(it?.day ?? 0);
    const qty = Number(it?.qty);
    if (!Number.isInteger(productId) || !Number.isInteger(day) || day < 0 || day > 7) {
      throw new ValidationError('Hay un producto inválido en el carrito.');
    }
    if (!Number.isInteger(qty) || qty < 1 || qty > MAX_QTY) {
      throw new ValidationError(`La cantidad de cada producto debe ser entre 1 y ${MAX_QTY}.`);
    }
    const key = `${productId}:${day}`;
    merged.set(key, { productId, day, qty: (merged.get(key)?.qty || 0) + qty });
  }

  const lines = [];
  for (const { productId, day, qty } of merged.values()) {
    const p = findItem.get(menu.id, productId, day);
    if (!p) throw new ValidationError('Uno de los productos ya no está en el menú. Actualizá la página.', 'items');
    if (!p.available) throw new ValidationError(`"${p.name}" está agotado. Quitalo del carrito para continuar.`, 'items');
    if (qty > MAX_QTY) throw new ValidationError(`Máximo ${MAX_QTY} unidades de "${p.name}".`);
    lines.push({
      product_id: p.id, day, day_name: day ? DAY_NAMES[day] : '',
      name: p.name, qty, unit_price: p.price, subtotal: p.price * qty,
    });
  }
  const dayKey = (d) => (d === 0 ? 8 : d); // "toda la semana" al final
  lines.sort((a, b) => dayKey(a.day) - dayKey(b.day) || a.name.localeCompare(b.name));
  const subtotal = lines.reduce((s, l) => s + l.subtotal, 0);

  // --- Datos del cliente ---
  const c = payload?.customer || {};
  const name = clean(c.name, 80);
  if (name.length < 2) throw new ValidationError('Ingresá tu nombre.', 'name');

  const method = c.delivery_method === 'retiro' ? 'retiro' : c.delivery_method === 'envio' ? 'envio' : null;
  if (!method) throw new ValidationError('Elegí la forma de entrega.', 'delivery_method');
  if (method === 'envio' && !settings.delivery_enabled) throw new ValidationError('Por el momento no hacemos envíos.', 'delivery_method');
  if (method === 'retiro' && !settings.pickup_enabled) throw new ValidationError('Por el momento no hay retiro en el local.', 'delivery_method');

  let address = '';
  let zoneName = '';
  let deliveryCost = 0;
  if (method === 'envio') {
    address = clean(c.address, 200);
    if (address.length < 5) throw new ValidationError('Ingresá la dirección de entrega.', 'address');
    const zones = db.prepare('SELECT * FROM delivery_zones WHERE active = 1').all();
    if (zones.length > 0) {
      const zone = zones.find((z) => z.id === Number(c.zone_id));
      if (!zone) throw new ValidationError('Elegí tu zona de entrega.', 'zone_id');
      zoneName = zone.name;
      deliveryCost = zone.cost;
    }
  }

  const minOrder = Number(settings.min_order) || 0;
  if (method === 'envio' && minOrder > 0 && subtotal < minOrder) {
    throw new ValidationError(`El pedido mínimo para envío es de ${money(minOrder)}.`, 'items');
  }

  let payment = '';
  const methods = Array.isArray(settings.payment_methods) ? settings.payment_methods : [];
  if (methods.length > 0) {
    payment = clean(c.payment_method, 60);
    if (!methods.includes(payment)) throw new ValidationError('Elegí la forma de pago.', 'payment_method');
  }

  const notes = cleanMultiline(c.notes, 500);
  const total = subtotal + deliveryCost;
  const code = crypto.randomBytes(4).toString('hex').toUpperCase().slice(0, 6);

  // --- Mensaje de WhatsApp ---
  const msg = [];
  msg.push('¡Hola! Quiero realizar el siguiente pedido:', '');
  let lastDay = null;
  const hasDays = lines.some((l) => l.day !== 0);
  for (const l of lines) {
    if (hasDays && l.day !== lastDay) {
      if (lastDay !== null) msg.push('');
      msg.push(`*${l.day ? l.day_name : 'Para cualquier día'}*`);
      lastDay = l.day;
    }
    msg.push(`${l.qty}x ${l.name} - ${money(l.subtotal)}`);
  }
  msg.push('');
  if (deliveryCost > 0 || method === 'envio') {
    msg.push(`Subtotal: ${money(subtotal)}`);
    msg.push(`Envío${zoneName ? ` (${zoneName})` : ''}: ${deliveryCost > 0 ? money(deliveryCost) : 'a coordinar'}`);
  }
  msg.push(`*Total: ${money(total)}*`, '');
  msg.push(`Nombre: ${name}`);
  msg.push(`Forma de entrega: ${method === 'envio' ? 'Envío a domicilio' : 'Retiro en el local'}`);
  if (method === 'envio') msg.push(`Dirección: ${address}${zoneName ? ` (${zoneName})` : ''}`);
  if (payment) msg.push(`Forma de pago: ${payment}`);
  msg.push(`Observaciones: ${notes || '-'}`);
  msg.push('', `Pedido N° ${code}`, '¡Muchas gracias!');
  const message = msg.join('\n');

  return {
    code, menu_id: menu.id, lines, subtotal, delivery_cost: deliveryCost, total,
    customer: { name, address, delivery_method: method, zone_name: zoneName, payment_method: payment, notes },
    message,
    whatsapp_url: `https://wa.me/${wa}?text=${encodeURIComponent(message)}`,
    created_for: now().date,
  };
}

function saveOrder(o) {
  db.prepare(`
    INSERT INTO orders (code, customer_name, address, delivery_method, zone_name, payment_method, notes,
                        items_json, subtotal, delivery_cost, total, message)
    VALUES (@code, @name, @address, @delivery_method, @zone_name, @payment_method, @notes,
            @items_json, @subtotal, @delivery_cost, @total, @message)
  `).run({
    code: o.code, ...o.customer, items_json: JSON.stringify(o.lines),
    subtotal: o.subtotal, delivery_cost: o.delivery_cost, total: o.total, message: o.message,
  });
}

module.exports = { buildOrder, saveOrder, ValidationError, normalizeWhatsapp, isValidWhatsapp, money };
