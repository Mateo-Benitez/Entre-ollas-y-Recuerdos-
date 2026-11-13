/* ==========================================================================
   Tienda de viandas caseras — lógica pública (menú, carrito y pedido)
   ========================================================================== */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });
const money = (n) => fmt.format(n || 0);
const PLACEHOLDER = '/img/plato.svg';
const CART_KEY = 'viandas_cart_v1';
const CUSTOMER_KEY = 'viandas_cliente_v1';
const MAX_QTY = 50;

const state = {
  store: null,
  productsById: new Map(),
  cart: new Map(),            // "productId:day" -> qty
  view: 'day',
  filter: 'all',
  selectedDay: new Map(),     // productId -> day elegido (vista por categoría)
  step: 1,
  order: null,
};

const storage = {
  get(k, def) { try { return JSON.parse(localStorage.getItem(k)) ?? def; } catch { return def; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* modo privado */ } },
};

// ----------------------------------------------------------------- utilidades
const dayName = (d) => state.store.day_names[d];
const shortDay = (d) => (d === 0 ? 'Cualquier día' : dayName(d));
const keyOf = (pid, day) => `${pid}:${day}`;
const dayOrder = (d) => (d === 0 ? 8 : d);

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('is-show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('is-show'), 2400);
}

function waLink(text) {
  const n = state.store?.settings.whatsapp;
  return n ? `https://wa.me/${n}${text ? `?text=${encodeURIComponent(text)}` : ''}` : null;
}

function formatRange(start, end) {
  const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const WD = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  const parts = (d) => { const dt = new Date(d + 'T12:00:00Z'); return { wd: WD[dt.getUTCDay()], day: dt.getUTCDate(), month: MONTHS[dt.getUTCMonth()] }; };
  const full = (d) => { const p = parts(d); return `${p.wd} ${p.day} de ${p.month}`; };
  if (start && end) {
    const a = parts(start);
    const sameMonth = start.slice(0, 7) === end.slice(0, 7);
    return `Del ${a.wd} ${a.day}${sameMonth ? '' : ` de ${a.month}`} al ${full(end)}`;
  }
  if (start) return `Desde el ${full(start)}`;
  if (end) return `Hasta el ${full(end)}`;
  return '';
}

/** ¿Se pueden tomar pedidos ahora? Devuelve null si sí, o el motivo si no. */
function orderBlockReason() {
  const s = state.store.settings;
  if (!s.orders_enabled) return 'En este momento no estamos tomando pedidos online. ¡Volvé pronto!';
  if (!s.whatsapp) return 'Los pedidos online no están disponibles temporalmente.';
  if (!state.store.status.is_open && !s.accept_orders_when_closed) return 'Estamos cerrados. Vas a poder hacer tu pedido en nuestro horario de atención.';
  return null;
}

// ----------------------------------------------------------------- carga
async function loadStore() {
  const res = await fetch('/api/store', { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error('No se pudo cargar la tienda');
  state.store = await res.json();
  state.productsById = new Map(state.store.products.map((p) => [p.id, p]));
}

function loadCart() {
  const saved = storage.get(CART_KEY, []);
  state.cart = new Map();
  let removed = 0;
  for (const it of Array.isArray(saved) ? saved : []) {
    const p = state.productsById.get(Number(it.product_id));
    const day = Number(it.day);
    const qty = Math.min(MAX_QTY, Math.max(0, Math.floor(Number(it.qty) || 0)));
    if (p && p.days.includes(day) && qty > 0) state.cart.set(keyOf(p.id, day), qty);
    else removed++;
  }
  if (removed) { saveCart(); toast('Algunos productos ya no están en el menú y se quitaron del carrito.'); }
}

function saveCart() {
  storage.set(CART_KEY, [...state.cart].map(([k, qty]) => {
    const [product_id, day] = k.split(':').map(Number);
    return { product_id, day, qty };
  }));
}

// ----------------------------------------------------------------- render: info del negocio
function renderBusiness() {
  const s = state.store.settings;
  document.title = `${s.business_name} · Viandas caseras`;
  $('#brandName').textContent = s.business_name;
  $('#footerName').textContent = s.business_name;
  $('#year').textContent = new Date().getFullYear();
  $('#brandLogo').src = s.logo || '/img/logo.svg';
  $('#heroTitle').textContent = s.slogan || 'Comida casera, rica y lista para disfrutar';
  $('#heroText').textContent = 'Elegí tus viandas de la semana, armá tu pedido en minutos y envialo directo por WhatsApp.';
  $('#aboutBody').textContent = s.about || '';
  const bg = $('#heroBg');
  if (s.hero_image) { bg.style.backgroundImage = `url("${encodeURI(s.hero_image)}")`; bg.classList.add('has-img'); }

  // Estado abierto/cerrado
  const st = $('#openStatus');
  st.hidden = false;
  st.className = 'status ' + (state.store.status.is_open ? 'is-open' : 'is-closed');
  st.textContent = state.store.status.is_open ? 'Abierto' : 'Cerrado';

  // WhatsApp
  const wa = waLink('¡Hola! Quería hacer una consulta.');
  for (const id of ['heroWa', 'contactWa', 'waFloat']) {
    const a = $('#' + id);
    a.hidden = !wa;
    if (wa) a.href = wa;
  }

  // Horarios
  const today = state.store.status.weekday;
  $('#hoursTable').innerHTML = (s.business_hours || []).map((h) => `
    <tr class="${h.day === today ? 'is-today' : ''} ${h.enabled ? '' : 'is-off'}">
      <td>${esc(dayName(h.day))}${h.day === today ? ' (hoy)' : ''}</td>
      <td>${h.enabled ? `${esc(h.open)} a ${esc(h.close)} hs` : 'Cerrado'}</td>
    </tr>`).join('');
  $('#hoursNote').textContent = s.hours_note || '';

  // Zonas
  const zones = state.store.zones;
  $('#zonesCard').hidden = !s.delivery_enabled;
  $('#zonesList').innerHTML = zones.length
    ? zones.map((z) => `<li><span>${esc(z.name)}</span><strong>${z.cost ? money(z.cost) : 'Sin cargo'}</strong></li>`).join('')
    : '<li><span>Consultanos por tu zona</span></li>';
  $('#minOrder').textContent = s.min_order > 0 ? `Pedido mínimo para envío: ${money(s.min_order)}` : '';

  // Envíos y retiros
  const blocks = [];
  if (s.delivery_enabled) blocks.push(`<div class="info-block"><h4>Envío a domicilio</h4><p>${esc(s.delivery_info || 'Consultanos por días y horarios de envío.')}</p></div>`);
  if (s.pickup_enabled) blocks.push(`<div class="info-block"><h4>Retiro en el local</h4><p>${esc(s.pickup_info || '')}${s.pickup_address ? `\n📍 ${esc(s.pickup_address)}` : ''}</p></div>`);
  if (s.payment_methods?.length) blocks.push(`<div class="info-block"><h4>Formas de pago</h4><p>${s.payment_methods.map(esc).join(' · ')}</p></div>`);
  $('#deliveryInfo').innerHTML = blocks.join('');

  // Contacto
  const c = [];
  if (s.whatsapp) c.push(`<li>💬 <a href="${esc(wa)}" target="_blank" rel="noopener">WhatsApp</a></li>`);
  if (s.phone) c.push(`<li>📞 <a href="tel:${esc(s.phone.replace(/[^\d+]/g, ''))}">${esc(s.phone)}</a></li>`);
  if (s.email) c.push(`<li>✉️ <a href="mailto:${esc(s.email)}">${esc(s.email)}</a></li>`);
  if (s.instagram) c.push(`<li>📷 <a href="https://instagram.com/${esc(encodeURIComponent(s.instagram))}" target="_blank" rel="noopener">@${esc(s.instagram)}</a></li>`);
  if (s.address) c.push(`<li>📍 ${esc(s.address)}</li>`);
  $('#contactList').innerHTML = c.join('') || '<li>Escribinos y te respondemos a la brevedad.</li>';
}

// ----------------------------------------------------------------- render: menú
function hasDayItems() {
  return state.store.products.some((p) => p.days.some((d) => d !== 0));
}

function renderMenuHeader() {
  const m = state.store.menu;
  $('#menuTitle').textContent = m ? m.title : 'Menú semanal';
  $('#menuDates').textContent = m ? formatRange(m.start_date, m.end_date) : '';
  $('#menuNote').hidden = !m?.notes;
  $('#menuNote').textContent = m?.notes || '';
  const reason = orderBlockReason();
  $('#ordersPaused').hidden = !reason;
  $('#ordersPaused').textContent = reason || '';
  $('#viewToggle').hidden = !hasDayItems() || state.store.categories.length === 0;
}

function renderChips() {
  const bar = $('#chipsBar');
  const products = state.store.products;
  if (!products.length) { bar.hidden = true; return; }
  let chips = [];
  if (state.view === 'day') {
    const days = [...new Set(products.flatMap((p) => p.days))].filter((d) => d !== 0).sort((a, b) => a - b);
    const today = state.store.status.weekday;
    chips = [{ id: 'all', label: 'Toda la semana' }, ...days.map((d) => ({ id: String(d), label: dayName(d), today: d === today }))];
    if (days.length === 0) chips = [];
  } else {
    const cats = new Map();
    for (const p of products) cats.set(p.category_id ?? 0, p.category_name);
    const order = state.store.categories.map((c) => c.id);
    const ids = [...cats.keys()].sort((a, b) => (order.indexOf(a) + 1 || 999) - (order.indexOf(b) + 1 || 999));
    chips = [{ id: 'all', label: 'Todas' }, ...ids.map((id) => ({ id: String(id), label: cats.get(id) }))];
    if (ids.length < 2) chips = [];
  }
  bar.hidden = chips.length === 0;
  if (!chips.some((c) => c.id === state.filter)) state.filter = 'all';
  $('#chips').innerHTML = chips.map((c) => `
    <button type="button" class="chip" role="tab" data-filter="${esc(c.id)}" aria-selected="${c.id === state.filter}">
      ${esc(c.label)}${c.today ? '<span class="today">HOY</span>' : ''}
    </button>`).join('');
}

function productCard(p, fixedDay) {
  const soldOut = !p.available;
  const multi = fixedDay === undefined && p.days.length > 1;
  const days = [...p.days].sort((a, b) => dayOrder(a) - dayOrder(b));
  const day = fixedDay !== undefined ? fixedDay : multi ? (state.selectedDay.get(p.id) ?? days[0]) : days[0];
  const showDays = fixedDay === undefined && !(days.length === 1 && days[0] === 0);
  return `
  <article class="product ${soldOut ? 'is-soldout' : ''}" data-pid="${p.id}">
    <div class="product__img">
      <img src="${esc(p.image || PLACEHOLDER)}" alt="${esc(p.name)}" loading="lazy" decoding="async" width="600" height="450">
      <span class="product__badge">${esc(p.category_name)}</span>
      ${soldOut ? '<div class="product__soldout"><span>Agotado</span></div>' : ''}
    </div>
    <div class="product__body">
      <h3 class="product__name">${esc(p.name)}</h3>
      ${p.description ? `<p class="product__desc">${esc(p.description)}</p>` : ''}
      ${p.ingredients ? `<details class="product__ing"><summary>Ingredientes</summary><p>${esc(p.ingredients)}</p></details>` : ''}
      ${showDays && !multi ? `<div class="product__days">${days.map((d) => `<span>${esc(shortDay(d))}</span>`).join('')}</div>` : ''}
      ${multi && !soldOut ? `
        <label class="sr-only" for="ds-${p.id}">Día</label>
        <select class="day-select" id="ds-${p.id}" data-pid="${p.id}" aria-label="Elegí el día">
          ${days.map((d) => `<option value="${d}" ${d === day ? 'selected' : ''}>Para el ${esc(shortDay(d).toLowerCase())}</option>`).join('')}
        </select>` : ''}
      <div class="product__foot">
        <span class="price">${money(p.price)}</span>
        <div data-ctrl data-pid="${p.id}" data-day="${day}">${controlHTML(p, day)}</div>
      </div>
    </div>
  </article>`;
}

function controlHTML(p, day) {
  if (!p.available) return '<button type="button" class="btn btn--ghost add-btn" disabled>Agotado</button>';
  if (orderBlockReason()) return '';
  const qty = state.cart.get(keyOf(p.id, day)) || 0;
  if (!qty) return `<button type="button" class="btn btn--primary add-btn" data-action="add">Agregar</button>`;
  return `
    <div class="stepper" role="group" aria-label="Cantidad de ${esc(p.name)}">
      <button type="button" data-action="dec" aria-label="Quitar uno">−</button>
      <output aria-live="polite">${qty}</output>
      <button type="button" data-action="inc" aria-label="Agregar uno" ${qty >= MAX_QTY ? 'disabled' : ''}>+</button>
    </div>`;
}

function renderProducts() {
  const grid = $('#products');
  const all = state.store.products;
  $('#menuEmpty').hidden = all.length > 0;
  if (!all.length) { grid.innerHTML = ''; return; }

  const html = [];
  const byName = (a, b) => a.name.localeCompare(b.name, 'es');
  if (state.view === 'day' && hasDayItems()) {
    const days = state.filter === 'all'
      ? [...new Set(all.flatMap((p) => p.days))].filter((d) => d !== 0).sort((a, b) => a - b)
      : [Number(state.filter)];
    for (const d of days) {
      const items = all.filter((p) => p.days.includes(d));
      if (!items.length) continue;
      if (state.filter === 'all') html.push(`<h3 class="group-title">${esc(dayName(d))}</h3>`);
      items.forEach((p) => html.push(productCard(p, d)));
    }
    const always = all.filter((p) => p.days.includes(0));
    if (always.length) {
      html.push('<h3 class="group-title">Disponibles toda la semana</h3>');
      always.forEach((p) => html.push(productCard(p, 0)));
    }
  } else {
    const groups = new Map();
    for (const p of all) {
      const cid = p.category_id ?? 0;
      if (state.filter !== 'all' && String(cid) !== state.filter) continue;
      if (!groups.has(cid)) groups.set(cid, { name: p.category_name, items: [] });
      groups.get(cid).items.push(p);
    }
    const order = state.store.categories.map((c) => c.id);
    const ids = [...groups.keys()].sort((a, b) => (order.indexOf(a) + 1 || 999) - (order.indexOf(b) + 1 || 999));
    for (const cid of ids) {
      const g = groups.get(cid);
      if (ids.length > 1 || state.filter === 'all') html.push(`<h3 class="group-title">${esc(g.name)}</h3>`);
      g.items.sort(byName).forEach((p) => html.push(productCard(p)));
    }
  }
  grid.innerHTML = html.join('');
}

function refreshControls() {
  const active = document.activeElement;
  const restore = active?.closest?.('[data-ctrl]') ? { ctrl: active.closest('[data-ctrl]'), action: active.dataset.action } : null;
  for (const el of $$('[data-ctrl]')) {
    const p = state.productsById.get(Number(el.dataset.pid));
    if (p) el.innerHTML = controlHTML(p, Number(el.dataset.day));
  }
  if (restore) {
    const target = restore.ctrl.querySelector(`[data-action="${restore.action}"]`) || restore.ctrl.querySelector('button:not(:disabled)');
    target?.focus();
  }
}

// ----------------------------------------------------------------- carrito
function setQty(pid, day, qty, { silent = false } = {}) {
  const p = state.productsById.get(pid);
  if (!p) return;
  const k = keyOf(pid, day);
  const prev = state.cart.get(k) || 0;
  qty = Math.max(0, Math.min(MAX_QTY, qty));
  if (qty > prev && !p.available) { toast(`"${p.name}" está agotado.`); return; }
  if (qty === 0) state.cart.delete(k); else state.cart.set(k, qty);
  saveCart();
  if (!silent && qty > prev && prev === 0) {
    toast(`Agregaste ${p.name}${day ? ` (${dayName(day)})` : ''}`);
    const b = $('#cartBtn'); b.classList.remove('bump'); void b.offsetWidth; b.classList.add('bump');
  }
  onCartChange();
}

function cartLines() {
  const lines = [];
  for (const [k, qty] of state.cart) {
    const [pid, day] = k.split(':').map(Number);
    const p = state.productsById.get(pid);
    const valid = !!p && p.days.includes(day);
    lines.push({ key: k, pid, day, qty, product: p, valid, soldOut: valid && !p.available, subtotal: valid ? p.price * qty : 0 });
  }
  return lines.sort((a, b) => dayOrder(a.day) - dayOrder(b.day) || (a.product?.name || '').localeCompare(b.product?.name || ''));
}

function cartSummary() {
  const lines = cartLines();
  const count = lines.reduce((s, l) => s + l.qty, 0);
  const subtotal = lines.reduce((s, l) => s + l.subtotal, 0);
  return { lines, count, subtotal, hasProblems: lines.some((l) => !l.valid || l.soldOut) };
}

function onCartChange() {
  const { count, subtotal } = cartSummary();
  $('#cartCount').hidden = count === 0;
  $('#cartCount').textContent = count;
  $('#cartBar').hidden = count === 0 || $('#drawer').classList.contains('is-open');
  $('#cartBarCount').textContent = count;
  $('#cartBarTotal').textContent = money(subtotal);
  document.body.classList.toggle('has-cartbar', !$('#cartBar').hidden);
  $('#waFloat').hidden = !state.store.settings.whatsapp;
  refreshControls();
  if ($('#drawer').classList.contains('is-open')) renderDrawer();
}

// ----------------------------------------------------------------- drawer / checkout
function openDrawer(step = 1) {
  const d = $('#drawer');
  d.classList.add('is-open');
  d.setAttribute('aria-hidden', 'false');
  document.body.classList.add('no-scroll');
  state.step = step;
  renderDrawer();
  onCartChange();
  setTimeout(() => $('.drawer__panel [data-close]').focus(), 50);
}
function closeDrawer() {
  const d = $('#drawer');
  d.classList.remove('is-open');
  d.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('no-scroll');
  if (state.step === 4) { state.step = 1; state.order = null; }
  onCartChange();
  $('#cartBtn').focus({ preventScroll: true });
}

function goStep(n) {
  state.step = n;
  $('#formError').hidden = true;
  renderDrawer();
  $$('.drawer__body').forEach((b) => (b.scrollTop = 0));
}

function renderDrawer() {
  const step = state.step;
  const sum = cartSummary();
  $$('.drawer__body').forEach((b) => (b.hidden = Number(b.dataset.step) !== Math.min(step, 3)));
  $$('#steps li').forEach((li, i) => {
    li.classList.toggle('is-active', i + 1 === step);
    li.classList.toggle('is-done', i + 1 < step);
  });
  $('#steps').hidden = sum.count === 0 && step === 1;
  $('#drawerBack').hidden = step === 1 || step === 4;
  $('#drawerTitle').textContent = ['Tu pedido', 'Tus datos', 'Revisá tu pedido', '¡Pedido listo!'][step - 1];
  $('#nextBtn').hidden = step >= 3;
  $('#sendBtn').hidden = step !== 3;
  $('#totals').hidden = step === 4;

  if (step === 1) {
    renderCartList(sum);
    const blocked = orderBlockReason();
    $('#nextBtn').textContent = 'Continuar';
    $('#nextBtn').disabled = sum.count === 0 || sum.hasProblems || !!blocked;
    $('#cartTotal').textContent = money(sum.subtotal);
    $('#totals span').textContent = 'Total';
    if (blocked && sum.count) showFormError(blocked);
  } else if (step === 2) {
    renderCheckoutForm();
    updateFormTotals();
    $('#nextBtn').textContent = 'Revisar pedido';
    $('#nextBtn').disabled = false;
  } else if (step === 3) {
    renderReview();
  } else if (step === 4) {
    renderDone();
  }
}

function renderCartList(sum) {
  $('#cartEmpty').hidden = sum.count > 0;
  const warn = [];
  if (sum.lines.some((l) => l.soldOut)) warn.push('Hay productos agotados en tu carrito. Quitalos para continuar.');
  if (sum.lines.some((l) => !l.valid)) warn.push('Hay productos que ya no están en el menú. Quitalos para continuar.');
  $('#cartWarnings').innerHTML = warn.map((w) => `<div class="warn-box">${esc(w)}</div>`).join('');
  $('#cartList').innerHTML = sum.lines.map((l) => {
    const p = l.product;
    const bad = !l.valid || l.soldOut;
    return `
    <li class="cart-item ${bad ? 'is-invalid' : ''}" data-key="${esc(l.key)}">
      <img src="${esc(p?.image || PLACEHOLDER)}" alt="" loading="lazy">
      <div>
        ${l.day ? `<span class="cart-item__day">${esc(dayName(l.day))}</span>` : ''}
        <p class="cart-item__name">${esc(p?.name || 'Producto no disponible')}</p>
        ${bad ? `<span class="cart-item__warn">${l.soldOut ? 'Agotado' : 'Ya no está en el menú'}</span>`
              : `<span class="cart-item__meta">${money(p.price)} c/u</span>`}
        <div><button type="button" class="link-btn" data-cart="remove">Eliminar</button></div>
      </div>
      <div class="cart-item__right">
        <span class="cart-item__sub">${money(l.subtotal)}</span>
        ${bad ? '' : `
        <div class="stepper stepper--sm" role="group" aria-label="Cantidad">
          <button type="button" data-cart="dec" aria-label="Quitar uno">−</button>
          <output>${l.qty}</output>
          <button type="button" data-cart="inc" aria-label="Agregar uno" ${l.qty >= MAX_QTY ? 'disabled' : ''}>+</button>
        </div>`}
      </div>
    </li>`;
  }).join('');
}

function renderCheckoutForm() {
  const s = state.store.settings;
  const saved = storage.get(CUSTOMER_KEY, {});
  const form = $('#checkoutForm');
  if (!form.dataset.ready) {
    // Opciones de entrega
    const opts = [];
    if (s.delivery_enabled) opts.push(['envio', 'Envío a domicilio', state.store.zones.length ? 'Costo según zona' : 'Te lo llevamos']);
    if (s.pickup_enabled) opts.push(['retiro', 'Retiro en el local', 'Sin costo']);
    $('#deliveryOptions').innerHTML = opts.map(([v, t, sub]) => `
      <label><input type="radio" name="delivery_method" value="${v}" required> ${esc(t)}<small>${esc(sub)}</small></label>`).join('');
    const def = opts.find((o) => o[0] === saved.delivery_method)?.[0] || (opts.length === 1 ? opts[0][0] : null);
    if (def) form.querySelector(`input[value="${def}"]`).checked = true;

    // Zonas
    const zones = state.store.zones;
    $('#zoneField').hidden = zones.length === 0;
    $('#fZone').innerHTML = '<option value="">Elegí tu zona…</option>' + zones.map((z) =>
      `<option value="${z.id}">${esc(z.name)} — ${z.cost ? money(z.cost) : 'sin cargo'}</option>`).join('');
    if (zones.some((z) => z.id === Number(saved.zone_id))) $('#fZone').value = saved.zone_id;

    // Pago
    const pm = s.payment_methods || [];
    $('#paymentField').hidden = pm.length === 0;
    $('#fPayment').innerHTML = '<option value="">Elegí cómo pagás…</option>' + pm.map((m) => `<option>${esc(m)}</option>`).join('');
    if (pm.includes(saved.payment_method)) $('#fPayment').value = saved.payment_method;

    $('#fName').value = saved.name || '';
    $('#fAddress').value = saved.address || '';
    form.dataset.ready = '1';
  }
  syncDeliveryFields();
}

function syncDeliveryFields() {
  const s = state.store.settings;
  const method = $('#checkoutForm').delivery_method?.value
    || $('input[name="delivery_method"]:checked')?.value;
  $('#deliveryFields').hidden = method !== 'envio';
  const hint = $('#pickupHint');
  hint.hidden = method !== 'retiro';
  hint.textContent = `📍 Retirás en: ${s.pickup_address || s.address || 'nuestro local (te confirmamos la dirección por WhatsApp)'}`;
  updateFormTotals();
}

function formData() {
  const f = $('#checkoutForm');
  return {
    name: f.name.value.trim(),
    delivery_method: $('input[name="delivery_method"]:checked')?.value || '',
    zone_id: f.zone_id.value ? Number(f.zone_id.value) : null,
    address: f.address.value.trim(),
    payment_method: f.payment_method.value,
    notes: f.notes.value.trim(),
  };
}

function updateFormTotals() {
  if (state.step !== 2) return;
  const sum = cartSummary();
  const d = formData();
  const zone = state.store.zones.find((z) => z.id === d.zone_id);
  const ship = d.delivery_method === 'envio' && zone ? zone.cost : 0;
  $('#totals span').textContent = ship ? `Total (envío ${money(ship)})` : 'Total';
  $('#cartTotal').textContent = money(sum.subtotal + ship);
}

function setFieldError(name, msg) {
  const el = $(`[data-err="${name}"]`);
  if (el) { el.textContent = msg || ''; el.closest('.field')?.classList.toggle('has-error', !!msg); }
}
function showFormError(msg) {
  const e = $('#formError');
  e.textContent = msg; e.hidden = !msg;
}

function validateForm() {
  const s = state.store.settings;
  const d = formData();
  const errs = {};
  if (d.name.length < 2) errs.name = 'Ingresá tu nombre.';
  if (!d.delivery_method) errs.delivery_method = 'Elegí cómo querés recibir tu pedido.';
  if (d.delivery_method === 'envio') {
    if (state.store.zones.length && !d.zone_id) errs.zone_id = 'Elegí tu zona.';
    if (d.address.length < 5) errs.address = 'Ingresá la dirección completa.';
    const sum = cartSummary();
    if (s.min_order > 0 && sum.subtotal < s.min_order) errs._ = `El pedido mínimo para envío es de ${money(s.min_order)}.`;
  }
  if ((s.payment_methods || []).length && !d.payment_method) errs.payment_method = 'Elegí la forma de pago.';
  ['name', 'delivery_method', 'zone_id', 'address', 'payment_method'].forEach((k) => setFieldError(k, errs[k]));
  showFormError(errs._ || '');
  const first = Object.keys(errs).find((k) => k !== '_');
  if (first) $(`[name="${first}"]`)?.focus();
  return Object.keys(errs).length === 0 ? d : null;
}

async function submitOrder() {
  const d = validateForm();
  if (!d) return;
  storage.set(CUSTOMER_KEY, { name: d.name, address: d.address, zone_id: d.zone_id, delivery_method: d.delivery_method, payment_method: d.payment_method });
  const btn = $('#nextBtn');
  btn.disabled = true;
  btn.textContent = 'Preparando tu pedido…';
  try {
    const items = cartLines().filter((l) => l.valid).map((l) => ({ product_id: l.pid, day: l.day, qty: l.qty }));
    const res = await fetch('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items, customer: d }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (data.field === 'items') {
        await refreshStore();
        goStep(1);
        showFormError(data.error);
        return;
      }
      if (data.field) setFieldError(data.field, data.error);
      showFormError(data.error || 'No pudimos procesar el pedido. Intentá de nuevo.');
      return;
    }
    state.order = data;
    goStep(3);
  } catch {
    showFormError('No hay conexión. Revisá tu internet e intentá de nuevo.');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Revisar pedido';
  }
}

function renderReview() {
  const o = state.order;
  if (!o) return goStep(2);
  const rows = [];
  let last = null;
  const hasDays = o.lines.some((l) => l.day !== 0);
  for (const l of o.lines) {
    if (hasDays && l.day !== last) { rows.push(`<li class="day">${esc(l.day ? l.day_name : 'Para cualquier día')}</li>`); last = l.day; }
    rows.push(`<li><span>${l.qty}x ${esc(l.name)}</span><span>${money(l.subtotal)}</span></li>`);
  }
  rows.push(`<li class="sum"><span>Subtotal</span><span>${money(o.subtotal)}</span></li>`);
  if (o.customer.delivery_method === 'envio') {
    rows.push(`<li><span>Envío${o.customer.zone_name ? ` (${esc(o.customer.zone_name)})` : ''}</span><span>${o.delivery_cost ? money(o.delivery_cost) : 'A coordinar'}</span></li>`);
  }
  rows.push(`<li class="total"><span>Total</span><span>${money(o.total)}</span></li>`);
  const c = o.customer;
  $('#review').innerHTML = `
    <div class="review-card"><h3>Productos</h3><ul class="review-lines">${rows.join('')}</ul></div>
    <div class="review-card"><h3>Entrega</h3>
      <dl>
        <dt>Nombre</dt><dd>${esc(c.name)}</dd>
        <dt>Entrega</dt><dd>${c.delivery_method === 'envio' ? 'Envío a domicilio' : 'Retiro en el local'}</dd>
        ${c.delivery_method === 'envio' ? `<dt>Dirección</dt><dd>${esc(c.address)}</dd>` : ''}
        ${c.payment_method ? `<dt>Pago</dt><dd>${esc(c.payment_method)}</dd>` : ''}
        <dt>Notas</dt><dd>${esc(c.notes || '-')}</dd>
      </dl>
    </div>
    <details class="review-card"><summary>Ver el mensaje que se enviará</summary><pre>${esc(o.message)}</pre></details>
    <p class="review-hint">Al tocar el botón se abre WhatsApp con tu pedido listo. Solo tenés que presionar <strong>Enviar</strong>.</p>`;
  $('#cartTotal').textContent = money(o.total);
  $('#totals span').textContent = 'Total';
  $('#sendBtn').href = o.whatsapp_url;
}

function renderDone() {
  const o = state.order;
  $('.drawer__body[data-step="3"]').hidden = false;
  $('#steps').hidden = true;
  $('#review').innerHTML = `
    <div class="empty">
      <span aria-hidden="true">🎉</span>
      <h3>¡Gracias, ${esc(o.customer.name.split(' ')[0])}!</h3>
      <p>Tu pedido <strong>N° ${esc(o.code)}</strong> se abrió en WhatsApp.<br>No te olvides de tocar <strong>Enviar</strong> en el chat.</p>
      <p><a class="btn btn--wa" href="${esc(o.whatsapp_url)}" target="_blank" rel="noopener">Abrir WhatsApp de nuevo</a></p>
      <p><button type="button" class="btn btn--ghost" data-close>Seguir viendo el menú</button></p>
    </div>`;
}

async function refreshStore() {
  try {
    await loadStore();
    loadCart();
    renderBusiness();
    renderMenuHeader();
    renderChips();
    renderProducts();
    onCartChange();
  } catch { /* se mantiene lo que ya estaba */ }
}

// ----------------------------------------------------------------- eventos
function bindEvents() {
  $('#cartBtn').addEventListener('click', () => openDrawer(1));
  $('#cartBar').addEventListener('click', () => openDrawer(1));
  $('#drawer').addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closeDrawer(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && $('#drawer').classList.contains('is-open')) closeDrawer(); });
  $('#drawerBack').addEventListener('click', () => goStep(state.step - 1));

  $('#nextBtn').addEventListener('click', () => {
    if (state.step === 1) goStep(2);
    else if (state.step === 2) submitOrder();
  });

  $('#sendBtn').addEventListener('click', () => {
    const o = state.order;
    if (!o) return;
    // Registramos que el pedido fue enviado (no bloquea la apertura de WhatsApp)
    try { navigator.sendBeacon(`/api/orders/${encodeURIComponent(o.code)}/sent`); } catch { /* sin efecto */ }
    state.cart.clear();
    saveCart();
    setTimeout(() => { state.step = 4; renderDrawer(); onCartChange(); }, 300);
  });

  // Controles de productos
  $('#products').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const ctrl = btn.closest('[data-ctrl]');
    const pid = Number(ctrl.dataset.pid);
    const day = Number(ctrl.dataset.day);
    const qty = state.cart.get(keyOf(pid, day)) || 0;
    if (btn.dataset.action === 'add' || btn.dataset.action === 'inc') setQty(pid, day, qty + 1);
    else if (btn.dataset.action === 'dec') setQty(pid, day, qty - 1);
  });
  $('#products').addEventListener('change', (e) => {
    const sel = e.target.closest('.day-select');
    if (!sel) return;
    const pid = Number(sel.dataset.pid);
    state.selectedDay.set(pid, Number(sel.value));
    const ctrl = sel.closest('.product').querySelector('[data-ctrl]');
    ctrl.dataset.day = sel.value;
    ctrl.innerHTML = controlHTML(state.productsById.get(pid), Number(sel.value));
  });

  // Carrito
  $('#cartList').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-cart]');
    if (!btn) return;
    const key = btn.closest('[data-key]').dataset.key;
    const [pid, day] = key.split(':').map(Number);
    const qty = state.cart.get(key) || 0;
    if (btn.dataset.cart === 'remove') { state.cart.delete(key); saveCart(); onCartChange(); }
    else setQty(pid, day, qty + (btn.dataset.cart === 'inc' ? 1 : -1), { silent: true });
    $('#formError').hidden = true;
  });

  // Formulario
  const form = $('#checkoutForm');
  form.addEventListener('change', (e) => {
    if (e.target.name === 'delivery_method') { setFieldError('delivery_method', ''); syncDeliveryFields(); }
    if (e.target.name === 'zone_id') { setFieldError('zone_id', ''); updateFormTotals(); }
    if (e.target.name === 'payment_method') setFieldError('payment_method', '');
  });
  form.addEventListener('input', (e) => { if (e.target.name) setFieldError(e.target.name, ''); });
  form.addEventListener('submit', (e) => { e.preventDefault(); submitOrder(); });

  // Vistas y filtros
  $('#viewToggle').addEventListener('click', (e) => {
    const b = e.target.closest('[data-view]');
    if (!b || b.dataset.view === state.view) return;
    state.view = b.dataset.view;
    state.filter = 'all';
    $$('#viewToggle [data-view]').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
    renderChips();
    renderProducts();
  });
  $('#chips').addEventListener('click', (e) => {
    const c = e.target.closest('[data-filter]');
    if (!c) return;
    state.filter = c.dataset.filter;
    $$('#chips .chip').forEach((x) => x.setAttribute('aria-selected', String(x === c)));
    renderProducts();
    const top = $('#products').getBoundingClientRect().top + scrollY - 140;
    if (scrollY > top) scrollTo({ top, behavior: 'smooth' });
  });

  // Borde de la barra de filtros al quedar fija
  const bar = $('#chipsBar');
  new IntersectionObserver(([en]) => bar.classList.toggle('is-stuck', en.intersectionRatio < 1),
    { rootMargin: '-65px 0px 0px 0px', threshold: [1] }).observe(bar);

  // Sincroniza disponibilidad y precios al volver a la pestaña
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && state.step < 3) refreshStore(); });
  // Carrito sincronizado entre pestañas
  addEventListener('storage', (e) => { if (e.key === CART_KEY) { loadCart(); onCartChange(); } });
}

// ----------------------------------------------------------------- inicio
(async function init() {
  bindEvents();
  try {
    await loadStore();
  } catch {
    $('#products').innerHTML = '<div class="empty" style="grid-column:1/-1"><span>⚠️</span><h3>No pudimos cargar el menú</h3><p>Revisá tu conexión y recargá la página.</p></div>';
    return;
  }
  loadCart();
  state.view = hasDayItems() ? 'day' : 'category';
  $$('#viewToggle [data-view]').forEach((x) => x.setAttribute('aria-selected', String(x.dataset.view === state.view)));
  // Por defecto mostramos el día de hoy si tiene viandas
  const today = String(state.store.status.weekday);
  if (state.view === 'day' && state.store.products.some((p) => p.days.includes(Number(today)))) state.filter = today;
  renderBusiness();
  renderMenuHeader();
  renderChips();
  renderProducts();
  onCartChange();
})();
