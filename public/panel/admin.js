/* ==========================================================================
   Panel de administración — viandas caseras
   ========================================================================== */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });
const money = (n) => fmt.format(n || 0);
const PLACEHOLDER = '/img/plato.svg';
const DAYS = ['Todos los días', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
const DAYS_SHORT = ['Todos', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const main = $('#main');

// ----------------------------------------------------------------- API
async function api(method, url, body) {
  const opts = { method, headers: { 'X-Requested-With': 'fetch', Accept: 'application/json' } };
  if (body instanceof FormData) opts.body = body;
  else if (body !== undefined) { opts.body = JSON.stringify(body); opts.headers['Content-Type'] = 'application/json'; }
  let res;
  try { res = await fetch('/api/admin' + url, opts); } catch { throw new Error('Sin conexión. Revisá tu internet.'); }
  if (res.status === 401) { location.href = '/admin/login'; throw new Error('Sesión expirada.'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Ocurrió un error.');
  return data;
}

// ----------------------------------------------------------------- UI helpers
function toast(msg, type = 'ok') {
  const t = $('#toast');
  t.textContent = msg;
  t.className = `toast is-show toast--${type}`;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (t.className = 'toast'), type === 'error' ? 4000 : 2400);
}

/**
 * Modal genérico. onSubmit(form) puede lanzar un Error para mostrarlo sin cerrar.
 * Devuelve una promesa con el valor retornado por onSubmit (o null si se cancela).
 */
function modal({ title, body, submitLabel = 'Guardar', danger = false, onSubmit, onOpen, wide = false }) {
  const dlg = $('#modal');
  $('#modalTitle').textContent = title;
  $('#modalBody').innerHTML = body;
  $('#modalErr').hidden = true;
  dlg.classList.toggle('modal--wide', wide);
  $('#modalFoot').innerHTML = `
    <button type="button" class="btn btn--ghost" data-modal-close>Cancelar</button>
    <button type="submit" class="btn ${danger ? 'btn--danger' : 'btn--primary'}" id="modalSubmit">${esc(submitLabel)}</button>`;
  return new Promise((resolve) => {
    const form = $('#modalForm');
    let done = false;
    const finish = (v) => { if (done) return; done = true; cleanup(); if (dlg.open) dlg.close(); resolve(v); };
    const onClick = (e) => { if (e.target.closest('[data-modal-close]') || e.target === dlg) finish(null); };
    const onCancel = (e) => { e.preventDefault(); finish(null); };
    const onSub = async (e) => {
      e.preventDefault();
      const btn = $('#modalSubmit');
      btn.disabled = true;
      $('#modalErr').hidden = true;
      try { finish(onSubmit ? (await onSubmit(form)) ?? true : true); }
      catch (err) { $('#modalErr').textContent = err.message; $('#modalErr').hidden = false; }
      finally { btn.disabled = false; }
    };
    const cleanup = () => { dlg.removeEventListener('click', onClick); dlg.removeEventListener('cancel', onCancel); form.removeEventListener('submit', onSub); };
    dlg.addEventListener('click', onClick);
    dlg.addEventListener('cancel', onCancel);
    form.addEventListener('submit', onSub);
    dlg.showModal();
    onOpen?.(form);
    setTimeout(() => form.querySelector('input:not([type=hidden]):not([type=checkbox]), textarea, select')?.focus(), 30);
  });
}
const confirmDialog = (message, { okLabel = 'Eliminar', danger = true, title = '¿Estás seguro?' } = {}) =>
  modal({ title, body: `<p>${message}</p>`, submitLabel: okLabel, danger }).then(Boolean);

function setLoading() { main.innerHTML = '<div class="loading">Cargando…</div>'; }
function pageError(err) {
  main.innerHTML = `<div class="empty"><span>⚠️</span><h3>No se pudo cargar</h3><p>${esc(err.message)}</p>
    <button class="btn btn--primary" id="retryBtn">Reintentar</button></div>`;
  $('#retryBtn').onclick = () => router();
}
const switchHTML = (attrs, checked, label = '') =>
  `<label class="switch"><input type="checkbox" ${attrs} ${checked ? 'checked' : ''}><span class="switch__ui"></span>${label ? `<span class="switch__label">${label}</span>` : ''}</label>`;

function todayAR() {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date()).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}
function weekRange(offsetWeeks = 0) {
  const d = new Date(todayAR() + 'T12:00:00Z');
  const wd = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() - (wd - 1) + offsetWeeks * 7);
  const start = d.toISOString().slice(0, 10);
  d.setUTCDate(d.getUTCDate() + 6);
  return [start, d.toISOString().slice(0, 10)];
}
const fmtDate = (d) => d ? new Date(d + 'T12:00:00Z').toLocaleDateString('es-AR', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' }) : '';
const fmtDateTime = (s) => new Date(s.replace(' ', 'T') + 'Z').toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

function menuStatus(m, today = todayAR()) {
  if (!m.active) return { label: 'Inactivo', cls: 'muted' };
  if (m.is_current) return { label: 'Visible en la tienda', cls: 'ok' };
  if (m.start_date && m.start_date > today) return { label: `Programado · desde ${fmtDate(m.start_date)}`, cls: 'info' };
  if (m.end_date && m.end_date < today) return { label: 'Vencido', cls: 'muted' };
  return { label: 'Activo (hay otro más reciente)', cls: 'warn' };
}

// Cache liviano compartido entre pantallas
const cache = { settings: null };
async function getSettings(force = false) {
  if (!cache.settings || force) cache.settings = await api('GET', '/settings');
  return cache.settings;
}

// ----------------------------------------------------------------- router
let dirty = false;
const routes = {};
async function router() {
  const [name = 'inicio', param] = location.hash.replace(/^#\/?/, '').split('/');
  const route = routes[name] ? name : 'inicio';
  $$('[data-route]').forEach((a) => a.classList.toggle('is-active', a.dataset.route === route));
  $('#moreMenu').hidden = true;
  dirty = false;
  setLoading();
  try { await routes[route](param); } catch (e) { pageError(e); }
  main.focus({ preventScroll: true });
  scrollTo(0, 0);
}
let lastHash = location.hash;
addEventListener('hashchange', async () => {
  if (dirty && !(await confirmDialog('Tenés cambios sin guardar. ¿Querés salir igual?', { okLabel: 'Salir sin guardar', title: 'Cambios sin guardar' }))) {
    history.replaceState(null, '', lastHash);
    return;
  }
  lastHash = location.hash;
  router();
});
addEventListener('beforeunload', (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });

// =================================================================== INICIO
routes.inicio = async () => {
  const [d, s] = await Promise.all([api('GET', '/dashboard'), getSettings(true)]);
  const m = d.current_menu;
  main.innerHTML = `
    <header class="page-head"><div><h1>¡Hola! 👋</h1><p class="muted">Esto es lo que ve hoy tu clientela.</p></div></header>
    ${!d.whatsapp_ok ? `<div class="alert alert--warn"><strong>Falta configurar el WhatsApp.</strong> Sin número, los clientes no pueden enviar pedidos. <a href="#/config">Configurar ahora →</a></div>` : ''}
    ${!s.orders_enabled ? `<div class="alert alert--warn"><strong>Los pedidos están pausados.</strong> <a href="#/config">Reactivar →</a></div>` : ''}
    ${!m ? `<div class="alert alert--warn"><strong>No hay ningún menú visible en la tienda.</strong> Creá o activá un menú semanal. <a href="#/menu">Ir al menú →</a></div>` : ''}
    <div class="stats">
      <a class="stat" href="${m ? `#/menu/${m.id}` : '#/menu'}"><small>Menú en la tienda</small><strong>${m ? esc(m.title) : '—'}</strong><span>${m ? `${d.counts.menu_items} platos cargados` : 'Ninguno activo'}</span></a>
      <a class="stat" href="#/viandas"><small>Viandas</small><strong>${d.counts.products}</strong><span>${d.counts.sold_out} agotadas</span></a>
      <a class="stat" href="#/pedidos"><small>Pedidos (7 días)</small><strong>${d.counts.orders_week}</strong><span>enviados por WhatsApp</span></a>
    </div>
    <h2 class="section-title">Accesos rápidos</h2>
    <div class="quick">
      ${m ? `<a class="quick__item" href="#/menu/${m.id}"><span>✏️</span><strong>Editar el menú de esta semana</strong><small>Agregar o quitar platos por día</small></a>` : ''}
      <button class="quick__item" type="button" id="qNextWeek"><span>📅</span><strong>Armar el menú de la semana próxima</strong><small>${m ? 'Copia el actual para editarlo rápido' : 'Empezar uno nuevo'}</small></button>
      <a class="quick__item" href="#/viandas"><span>🚫</span><strong>Marcar viandas agotadas</strong><small>Se actualiza al instante</small></a>
      <button class="quick__item" type="button" id="qNewDish"><span>➕</span><strong>Cargar una vianda nueva</strong><small>Con foto, precio y descripción</small></button>
    </div>`;
  $('#qNewDish').onclick = async () => { if (await productModal()) toast('Vianda creada'); };
  $('#qNextWeek').onclick = () => createNextWeekMenu(m);
};

async function createNextWeekMenu(base) {
  const [start, end] = weekRange(1);
  try {
    let id;
    if (base) {
      ({ id } = await api('POST', `/menus/${base.id}/duplicate`));
      const copy = await api('GET', `/menus/${id}`);
      await api('PUT', `/menus/${id}`, { ...copy, title: `Semana del ${fmtDate(start)}`, start_date: start, end_date: end, active: true });
    } else {
      ({ id } = await api('POST', '/menus', { title: `Semana del ${fmtDate(start)}`, start_date: start, end_date: end, active: true }));
    }
    toast('Menú de la semana próxima creado. Se mostrará automáticamente desde el lunes.');
    location.hash = `#/menu/${id}`;
  } catch (e) { toast(e.message, 'error'); }
}

// =================================================================== MENÚ SEMANAL
routes.menu = async (param) => (param ? menuEditor(param) : menuList());

async function menuList() {
  const menus = await api('GET', '/menus');
  const current = menus.find((m) => m.is_current);
  main.innerHTML = `
    <header class="page-head">
      <div><h1>Menú semanal</h1><p class="muted">La tienda muestra automáticamente el menú activo que corresponde a la fecha de hoy.</p></div>
      <div class="page-actions">
        <button class="btn btn--ghost" id="nextWeekBtn">📅 Semana próxima</button>
        <a class="btn btn--primary" href="#/menu/nuevo">+ Nuevo menú</a>
      </div>
    </header>
    <details class="help"><summary>¿Cómo funciona?</summary>
      <p>Cada menú tiene un rango de fechas opcional y un interruptor de <strong>activo</strong>. La tienda muestra el menú activo cuyas fechas incluyen el día de hoy (si hay varios, el que empieza más tarde). Así podés <strong>programar</strong> el menú de la semana que viene: lo creás activo con fecha desde el próximo lunes y aparece solo ese día.</p>
      <p>Para armar la semana rápido, usá <strong>Duplicar</strong> sobre el menú anterior y cambiá solo lo necesario.</p>
    </details>
    ${menus.length === 0 ? `<div class="empty"><span>📅</span><h3>Todavía no hay menús</h3><p>Creá tu primer menú semanal y elegí qué viandas ofrecer cada día.</p><a class="btn btn--primary" href="#/menu/nuevo">Crear menú</a></div>` : ''}
    <div class="list">${menus.map((m) => {
      const st = menuStatus(m);
      return `
      <article class="row-card ${m.is_current ? 'is-current' : ''}" data-id="${m.id}">
        <div class="row-card__main">
          <h3><a href="#/menu/${m.id}">${esc(m.title)}</a></h3>
          <p class="muted">${m.start_date || m.end_date ? `${fmtDate(m.start_date) || '…'} → ${fmtDate(m.end_date) || '…'}` : 'Sin fechas (siempre)'} · ${m.item_count} platos</p>
          <span class="pill pill--${st.cls}">${st.label}</span>
        </div>
        <div class="row-card__actions">
          ${switchHTML(`data-act="toggle" aria-label="Activo"`, m.active, 'Activo')}
          <a class="btn btn--sm btn--primary" href="#/menu/${m.id}">Editar</a>
          <button class="btn btn--sm btn--ghost" data-act="dup">Duplicar</button>
          <button class="btn btn--sm btn--ghost btn--icon" data-act="del" aria-label="Eliminar">🗑</button>
        </div>
      </article>`;
    }).join('')}</div>`;

  $('#nextWeekBtn').onclick = () => createNextWeekMenu(current || menus[0]);
  main.querySelector('.list').addEventListener('click', async (e) => {
    const card = e.target.closest('[data-id]');
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!card || !act || act === 'toggle') return;
    const id = card.dataset.id;
    const m = menus.find((x) => String(x.id) === id);
    try {
      if (act === 'dup') {
        const r = await api('POST', `/menus/${id}/duplicate`);
        toast('Menú duplicado (queda inactivo hasta que lo actives)');
        location.hash = `#/menu/${r.id}`;
      } else if (act === 'del') {
        if (!(await confirmDialog(`Se eliminará el menú <strong>${esc(m.title)}</strong>. Las viandas no se borran.`))) return;
        await api('DELETE', `/menus/${id}`);
        toast('Menú eliminado');
        menuList();
      }
    } catch (err) { toast(err.message, 'error'); }
  });
  main.querySelector('.list').addEventListener('change', async (e) => {
    if (e.target.dataset.act !== 'toggle') return;
    const id = e.target.closest('[data-id]').dataset.id;
    try {
      await api('PATCH', `/menus/${id}`, { active: e.target.checked });
      toast(e.target.checked ? 'Menú activado' : 'Menú desactivado');
      menuList();
    } catch (err) { e.target.checked = !e.target.checked; toast(err.message, 'error'); }
  });
}

async function menuEditor(param) {
  const isNew = param === 'nuevo';
  const [products, categories, settings, menu] = await Promise.all([
    api('GET', '/products'), api('GET', '/categories'), getSettings(),
    isNew ? Promise.resolve(null) : api('GET', `/menus/${param}`),
  ]);
  const [ws, we] = weekRange(0);
  const m = menu || { title: `Semana del ${fmtDate(ws)}`, start_date: ws, end_date: we, notes: '', active: 1, items: [] };
  const selected = new Set(m.items.map((i) => `${i.product_id}:${i.day}`));
  const usedDays = new Set(m.items.map((i) => i.day));
  let days = [...new Set([...(settings.service_days || [1, 2, 3, 4, 5]), ...[...usedDays].filter((d) => d > 0)])].sort((a, b) => a - b);
  days.push(0);
  let filter = '';

  main.innerHTML = `
    <header class="page-head">
      <div><a href="#/menu" class="back">← Menús</a><h1>${isNew ? 'Nuevo menú' : 'Editar menú'}</h1></div>
      ${!isNew && menu.is_current ? '<span class="pill pill--ok">Visible en la tienda</span>' : ''}
    </header>
    <form id="menuForm" class="card" novalidate>
      <div class="grid-2">
        <label class="field"><span>Nombre del menú *</span><input name="title" maxlength="80" required value="${esc(m.title)}"></label>
        <div class="field"><span>Estado</span>${switchHTML('name="active"', m.active, 'Activo (visible según fechas)')}</div>
        <label class="field"><span>Desde</span><input type="date" name="start_date" value="${esc(m.start_date || '')}"></label>
        <label class="field"><span>Hasta</span><input type="date" name="end_date" value="${esc(m.end_date || '')}"></label>
      </div>
      <div class="chips-row">
        <span class="muted">Fechas rápidas:</span>
        <button type="button" class="chip" data-week="0">Esta semana</button>
        <button type="button" class="chip" data-week="1">Semana próxima</button>
        <button type="button" class="chip" data-week="none">Sin fechas</button>
      </div>
      <label class="field"><span>Nota para los clientes <small class="muted">(opcional)</small></span>
        <input name="notes" maxlength="400" value="${esc(m.notes || '')}" placeholder="Ej: Pedidos hasta las 20 hs del día anterior"></label>
    </form>

    <section class="card">
      <div class="matrix-head">
        <div><h2>Platos por día</h2><p class="muted">Tocá las casillas para ofrecer cada vianda el día que quieras. "Todos" = disponible cualquier día.</p></div>
        <div class="matrix-tools">
          <input type="search" id="mSearch" placeholder="Buscar vianda…" aria-label="Buscar vianda">
          <button type="button" class="btn btn--ghost btn--sm" id="mNewDish">+ Nueva vianda</button>
        </div>
      </div>
      <div class="matrix-days">
        <span class="muted">Días que se muestran:</span>
        ${[1, 2, 3, 4, 5, 6, 7].map((d) => `<label class="mini-check"><input type="checkbox" data-showday="${d}" ${days.includes(d) ? 'checked' : ''}>${DAYS_SHORT[d]}</label>`).join('')}
      </div>
      <div class="matrix-wrap" id="matrixWrap"></div>
    </section>

    <div class="savebar" id="saveBar">
      <span id="saveState" class="muted"></span>
      ${!isNew ? '<button type="button" class="btn btn--ghost" id="viewStore">Ver tienda</button>' : ''}
      <button type="button" class="btn btn--primary" id="saveMenu">${isNew ? 'Crear menú' : 'Guardar cambios'}</button>
    </div>`;

  const markDirty = () => { dirty = true; $('#saveState').textContent = '● Cambios sin guardar'; $('#saveState').className = 'warn-text'; };

  function renderMatrix() {
    const byCat = new Map();
    const q = filter.toLowerCase();
    for (const p of products) {
      if (q && !p.name.toLowerCase().includes(q)) continue;
      const k = p.category_id ?? 0;
      if (!byCat.has(k)) byCat.set(k, { name: p.category_name || 'Sin categoría', items: [] });
      byCat.get(k).items.push(p);
    }
    const order = categories.map((c) => c.id);
    const cats = [...byCat.keys()].sort((a, b) => (order.indexOf(a) + 1 || 999) - (order.indexOf(b) + 1 || 999));
    const count = (d) => [...selected].filter((k) => k.endsWith(':' + d)).length;
    if (!products.length) {
      $('#matrixWrap').innerHTML = `<div class="empty"><span>🍲</span><h3>Primero cargá tus viandas</h3><p>Después vas a poder elegir qué día ofrecer cada una.</p></div>`;
      return;
    }
    $('#matrixWrap').innerHTML = `
      <table class="matrix">
        <thead><tr><th class="matrix__name">Vianda</th>${days.map((d) => `<th><span>${DAYS_SHORT[d]}</span><small>${count(d)}</small></th>`).join('')}</tr></thead>
        <tbody>${cats.map((cid) => `
          <tr class="matrix__cat"><td colspan="${days.length + 1}">${esc(byCat.get(cid).name)}</td></tr>
          ${byCat.get(cid).items.map((p) => `
            <tr class="${p.available ? '' : 'is-soldout'}">
              <th class="matrix__name" scope="row"><div class="mn">
                <img src="${esc(p.image || PLACEHOLDER)}" alt="">
                <div><strong>${esc(p.name)}</strong><small>${money(p.price)}</small>
                ${switchHTML(`data-avail="${p.id}" aria-label="Disponible"`, p.available, p.available ? 'Disponible' : 'Agotado')}</div>
              </div></th>
              ${days.map((d) => `<td><label class="cell"><input type="checkbox" data-cell="${p.id}:${d}" ${selected.has(`${p.id}:${d}`) ? 'checked' : ''} aria-label="${esc(p.name)} – ${DAYS[d]}"><span></span></label></td>`).join('')}
            </tr>`).join('')}`).join('')}
        </tbody>
      </table>
      ${byCat.size === 0 ? '<p class="muted center">No hay viandas que coincidan con la búsqueda.</p>' : ''}`;
  }
  renderMatrix();
  $('#saveState').textContent = `${selected.size} platos en el menú`;

  $('#menuForm').addEventListener('input', markDirty);
  $('#menuForm').addEventListener('change', markDirty);
  $$('[data-week]').forEach((b) => b.onclick = () => {
    const f = $('#menuForm');
    if (b.dataset.week === 'none') { f.start_date.value = ''; f.end_date.value = ''; }
    else {
      const [s, e] = weekRange(Number(b.dataset.week));
      f.start_date.value = s; f.end_date.value = e;
      if (/^Semana del/.test(f.title.value) || !f.title.value) f.title.value = `Semana del ${fmtDate(s)}`;
    }
    markDirty();
  });
  $('#mSearch').addEventListener('input', (e) => { filter = e.target.value.trim(); renderMatrix(); });
  $$('[data-showday]').forEach((cb) => cb.onchange = () => {
    const d = Number(cb.dataset.showday);
    if (cb.checked) days = [...days.filter((x) => x !== 0), d].sort((a, b) => a - b).concat(0);
    else {
      if ([...selected].some((k) => k.endsWith(':' + d))) {
        cb.checked = true;
        toast(`Primero desmarcá las viandas del ${DAYS[d].toLowerCase()}`, 'error');
        return;
      }
      days = days.filter((x) => x !== d);
    }
    renderMatrix();
  });
  $('#matrixWrap').addEventListener('change', async (e) => {
    const cell = e.target.dataset.cell;
    if (cell) {
      if (e.target.checked) selected.add(cell); else selected.delete(cell);
      markDirty();
      const d = Number(cell.split(':')[1]);
      const idx = days.indexOf(d);
      const th = $$('.matrix thead th')[idx + 1];
      if (th) th.querySelector('small').textContent = [...selected].filter((k) => k.endsWith(':' + d)).length;
      $('#saveState').textContent = `● ${selected.size} platos · cambios sin guardar`;
      return;
    }
    const pid = e.target.dataset.avail;
    if (pid) {
      const p = products.find((x) => String(x.id) === pid);
      try {
        await api('PATCH', `/products/${pid}`, { available: e.target.checked });
        p.available = e.target.checked ? 1 : 0;
        toast(`${p.name}: ${p.available ? 'disponible' : 'agotado'} (ya se ve en la tienda)`);
        renderMatrix();
      } catch (err) { e.target.checked = !e.target.checked; toast(err.message, 'error'); }
    }
  });
  $('#mNewDish').onclick = async () => {
    const created = await productModal();
    if (created) {
      const fresh = await api('GET', '/products');
      products.splice(0, products.length, ...fresh);
      renderMatrix();
      toast('Vianda creada. Marcá los días en que la ofrecés.');
    }
  };
  $('#viewStore')?.addEventListener('click', () => open('/', '_blank'));

  $('#saveMenu').onclick = async () => {
    const f = $('#menuForm');
    const body = { title: f.title.value.trim(), start_date: f.start_date.value, end_date: f.end_date.value, notes: f.notes.value.trim(), active: f.active.checked };
    if (!body.title) { toast('Poné un nombre al menú', 'error'); f.title.focus(); return; }
    const items = [...selected].map((k) => { const [product_id, day] = k.split(':').map(Number); return { product_id, day }; });
    const btn = $('#saveMenu');
    btn.disabled = true;
    try {
      let id = param;
      if (isNew) ({ id } = await api('POST', '/menus', body));
      else await api('PUT', `/menus/${id}`, body);
      await api('PUT', `/menus/${id}/items`, { items });
      dirty = false;
      toast('Menú guardado ✔');
      if (isNew) { lastHash = `#/menu/${id}`; history.replaceState(null, '', lastHash); }
      menuEditor(id);
    } catch (err) { toast(err.message, 'error'); }
    finally { btn.disabled = false; }
  };
}

// =================================================================== VIANDAS
async function productModal(p = null) {
  const cats = await api('GET', '/categories');
  return modal({
    title: p ? 'Editar vianda' : 'Nueva vianda',
    wide: true,
    submitLabel: p ? 'Guardar cambios' : 'Crear vianda',
    body: `
      <div class="product-form">
        <div class="photo-field">
          <img id="pfPreview" src="${esc(p?.image || PLACEHOLDER)}" alt="Foto de la vianda">
          <label class="btn btn--ghost btn--sm">📷 ${p?.image ? 'Cambiar foto' : 'Subir foto'}
            <input type="file" name="image" accept="image/*" hidden></label>
          ${p?.image ? '<label class="mini-check"><input type="checkbox" name="remove_image"> Quitar foto</label>' : ''}
          <small class="muted">JPG, PNG o WEBP. Se optimiza automáticamente.</small>
        </div>
        <div>
          <label class="field"><span>Nombre del plato *</span><input name="name" maxlength="100" required value="${esc(p?.name || '')}"></label>
          <div class="grid-2">
            <label class="field"><span>Precio *</span><div class="input-prefix"><b>$</b><input name="price" inputmode="numeric" required value="${p ? p.price : ''}" placeholder="0"></div></label>
            <label class="field"><span>Categoría</span>
              <select name="category_id"><option value="">Sin categoría</option>
              ${cats.map((c) => `<option value="${c.id}" ${p?.category_id === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
            </label>
          </div>
          <label class="field"><span>Descripción</span><textarea name="description" rows="2" maxlength="600">${esc(p?.description || '')}</textarea></label>
          <label class="field"><span>Ingredientes</span><textarea name="ingredients" rows="2" maxlength="600" placeholder="Separados por coma">${esc(p?.ingredients || '')}</textarea></label>
          ${switchHTML('name="available"', p ? p.available : true, 'Disponible (desmarcá si está agotada)')}
        </div>
      </div>`,
    onOpen: (form) => {
      form.image.addEventListener('change', () => {
        const file = form.image.files[0];
        if (!file) return;
        if (file.size > 10 * 1024 * 1024) { toast('La foto pesa más de 10 MB', 'error'); form.image.value = ''; return; }
        $('#pfPreview').src = URL.createObjectURL(file);
      });
    },
    onSubmit: async (form) => {
      if (!form.name.value.trim()) throw new Error('Ingresá el nombre del plato.');
      const price = form.price.value.replace(/[.\s$]/g, '').replace(',', '.');
      if (price === '' || Number.isNaN(Number(price)) || Number(price) < 0) throw new Error('Ingresá un precio válido.');
      const fd = new FormData();
      fd.append('name', form.name.value.trim());
      fd.append('price', price);
      fd.append('category_id', form.category_id.value);
      fd.append('description', form.description.value.trim());
      fd.append('ingredients', form.ingredients.value.trim());
      fd.append('available', form.available.checked ? '1' : '0');
      if (form.image.files[0]) fd.append('image', form.image.files[0]);
      if (form.remove_image?.checked) fd.append('remove_image', '1');
      $('#modalSubmit').textContent = 'Guardando…';
      return p ? api('PUT', `/products/${p.id}`, fd) : api('POST', '/products', fd);
    },
  });
}

routes.viandas = async () => {
  const [products, cats] = await Promise.all([api('GET', '/products'), api('GET', '/categories')]);
  let q = '';
  let cat = '';
  let only = '';
  main.innerHTML = `
    <header class="page-head">
      <div><h1>Viandas</h1><p class="muted">${products.length} platos cargados. Los cambios se ven al instante en la tienda.</p></div>
      <div class="page-actions"><button class="btn btn--primary" id="newDish">+ Nueva vianda</button></div>
    </header>
    <div class="toolbar">
      <input type="search" id="pSearch" placeholder="Buscar…" aria-label="Buscar vianda">
      <select id="pCat" aria-label="Filtrar por categoría"><option value="">Todas las categorías</option>
        ${cats.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}<option value="none">Sin categoría</option></select>
      <select id="pAvail" aria-label="Filtrar por disponibilidad"><option value="">Todas</option><option value="1">Disponibles</option><option value="0">Agotadas</option></select>
    </div>
    <div class="list" id="pList"></div>`;

  function render() {
    const list = products.filter((p) =>
      (!q || p.name.toLowerCase().includes(q)) &&
      (!cat || (cat === 'none' ? !p.category_id : String(p.category_id) === cat)) &&
      (only === '' || String(p.available) === only));
    $('#pList').innerHTML = products.length === 0
      ? `<div class="empty"><span>🍲</span><h3>Todavía no cargaste viandas</h3><p>Empezá por tus platos más pedidos.</p></div>`
      : list.length === 0 ? '<p class="muted center">No hay resultados.</p>'
      : list.map((p) => `
      <article class="dish ${p.available ? '' : 'is-soldout'}" data-id="${p.id}">
        <img src="${esc(p.image || PLACEHOLDER)}" alt="" loading="lazy">
        <div class="dish__main">
          <h3>${esc(p.name)}</h3>
          <p class="muted">${esc(p.category_name || 'Sin categoría')}</p>
          <div class="price-edit"><b>$</b><input type="text" inputmode="numeric" value="${p.price}" data-price aria-label="Precio de ${esc(p.name)}"></div>
        </div>
        <div class="dish__actions">
          ${switchHTML('data-avail aria-label="Disponible"', p.available, p.available ? 'Disponible' : 'Agotada')}
          <div class="btn-group">
            <button class="btn btn--sm btn--ghost" data-act="edit">Editar</button>
            <button class="btn btn--sm btn--ghost btn--icon" data-act="del" aria-label="Eliminar">🗑</button>
          </div>
        </div>
      </article>`).join('');
  }
  render();

  const reload = async () => { products.splice(0, products.length, ...(await api('GET', '/products'))); render(); };
  $('#newDish').onclick = async () => { if (await productModal()) { toast('Vianda creada'); reload(); } };
  $('#pSearch').oninput = (e) => { q = e.target.value.trim().toLowerCase(); render(); };
  $('#pCat').onchange = (e) => { cat = e.target.value; render(); };
  $('#pAvail').onchange = (e) => { only = e.target.value; render(); };

  const list = $('#pList');
  list.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    const p = products.find((x) => String(x.id) === e.target.closest('[data-id]').dataset.id);
    if (act === 'edit') { if (await productModal(p)) { toast('Cambios guardados'); reload(); } }
    if (act === 'del') {
      if (!(await confirmDialog(`Se eliminará <strong>${esc(p.name)}</strong> y se quitará de todos los menús. Si solo está agotada, mejor marcala como agotada.`))) return;
      try { await api('DELETE', `/products/${p.id}`); toast('Vianda eliminada'); reload(); } catch (err) { toast(err.message, 'error'); }
    }
  });
  list.addEventListener('change', async (e) => {
    const card = e.target.closest('[data-id]');
    if (!card) return;
    const p = products.find((x) => String(x.id) === card.dataset.id);
    if (e.target.matches('[data-avail]')) {
      try {
        await api('PATCH', `/products/${p.id}`, { available: e.target.checked });
        p.available = e.target.checked ? 1 : 0;
        card.classList.toggle('is-soldout', !p.available);
        e.target.closest('.switch').querySelector('.switch__label').textContent = p.available ? 'Disponible' : 'Agotada';
        toast(`${p.name}: ${p.available ? 'disponible' : 'agotada'}`);
      } catch (err) { e.target.checked = !e.target.checked; toast(err.message, 'error'); }
    }
    if (e.target.matches('[data-price]')) {
      const val = e.target.value.replace(/[.\s$]/g, '').replace(',', '.');
      if (val === '' || Number.isNaN(Number(val)) || Number(val) < 0) { toast('Precio inválido', 'error'); e.target.value = p.price; return; }
      try {
        await api('PATCH', `/products/${p.id}`, { price: val });
        p.price = Math.round(Number(val));
        e.target.value = p.price;
        toast(`Precio actualizado: ${money(p.price)}`);
      } catch (err) { toast(err.message, 'error'); e.target.value = p.price; }
    }
  });
  list.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.matches('[data-price]')) e.target.blur(); });
};

// =================================================================== CATEGORÍAS
routes.categorias = async () => {
  const cats = await api('GET', '/categories');
  main.innerHTML = `
    <header class="page-head"><div><h1>Categorías</h1><p class="muted">Ordenan las viandas en la tienda (ej: Platos principales, Tartas, Postres).</p></div></header>
    <form class="card inline-form" id="catForm">
      <input name="name" maxlength="60" placeholder="Nueva categoría" aria-label="Nombre de la nueva categoría" required>
      <button class="btn btn--primary">Agregar</button>
    </form>
    <div class="list" id="catList">
      ${cats.length === 0 ? '<p class="muted center">Todavía no hay categorías.</p>' : cats.map((c, i) => `
        <article class="row-card row-card--compact" data-id="${c.id}">
          <div class="order-btns">
            <button class="icon-btn" data-act="up" ${i === 0 ? 'disabled' : ''} aria-label="Subir">▲</button>
            <button class="icon-btn" data-act="down" ${i === cats.length - 1 ? 'disabled' : ''} aria-label="Bajar">▼</button>
          </div>
          <div class="row-card__main"><h3>${esc(c.name)}</h3><p class="muted">${c.product_count} viandas</p></div>
          <div class="row-card__actions">
            <button class="btn btn--sm btn--ghost" data-act="edit">Renombrar</button>
            <button class="btn btn--sm btn--ghost btn--icon" data-act="del" aria-label="Eliminar">🗑</button>
          </div>
        </article>`).join('')}
    </div>`;
  $('#catForm').onsubmit = async (e) => {
    e.preventDefault();
    try { await api('POST', '/categories', { name: e.target.name.value.trim() }); toast('Categoría creada'); routes.categorias(); }
    catch (err) { toast(err.message, 'error'); }
  };
  $('#catList').onclick = async (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    const id = Number(e.target.closest('[data-id]').dataset.id);
    const idx = cats.findIndex((c) => c.id === id);
    const c = cats[idx];
    try {
      if (act === 'up' || act === 'down') {
        const ids = cats.map((x) => x.id);
        const j = act === 'up' ? idx - 1 : idx + 1;
        [ids[idx], ids[j]] = [ids[j], ids[idx]];
        await api('PUT', '/categories-order', { ids });
        routes.categorias();
      } else if (act === 'edit') {
        const ok = await modal({
          title: 'Renombrar categoría',
          body: `<label class="field"><span>Nombre</span><input name="name" maxlength="60" value="${esc(c.name)}" required></label>`,
          onSubmit: (f) => api('PUT', `/categories/${id}`, { name: f.name.value.trim() }),
        });
        if (ok) { toast('Categoría actualizada'); routes.categorias(); }
      } else if (act === 'del') {
        if (!(await confirmDialog(`Se eliminará <strong>${esc(c.name)}</strong>. ${c.product_count ? `Sus ${c.product_count} viandas quedarán "sin categoría".` : ''}`))) return;
        await api('DELETE', `/categories/${id}`);
        toast('Categoría eliminada');
        routes.categorias();
      }
    } catch (err) { toast(err.message, 'error'); }
  };
};

// =================================================================== PEDIDOS
const ORDER_STATUS = {
  enviado: 'Nuevo', confirmado: 'Confirmado', entregado: 'Entregado', cancelado: 'Cancelado', generado: 'No enviado',
};
routes.pedidos = async (param) => {
  const status = param && ORDER_STATUS[param] ? param : '';
  const orders = await api('GET', `/orders${status ? `?status=${status}` : ''}`);
  main.innerHTML = `
    <header class="page-head"><div><h1>Pedidos</h1>
      <p class="muted">Registro de pedidos enviados desde la tienda. El pedido real llega a tu WhatsApp: confirmalo siempre por el chat.</p></div></header>
    <div class="chips-row">
      <a class="chip ${!status ? 'is-on' : ''}" href="#/pedidos">Todos</a>
      ${['enviado', 'confirmado', 'entregado', 'cancelado', 'generado'].map((s) => `<a class="chip ${status === s ? 'is-on' : ''}" href="#/pedidos/${s}">${ORDER_STATUS[s]}</a>`).join('')}
    </div>
    ${status === 'generado' ? '<p class="help">"No enviado": el cliente llegó a revisar el pedido pero no tocó el botón de WhatsApp.</p>' : ''}
    <div class="list" id="oList">
      ${orders.length === 0 ? '<div class="empty"><span>🧾</span><h3>No hay pedidos para mostrar</h3></div>' : orders.map((o) => `
      <article class="order" data-id="${o.id}">
        <header>
          <div><strong>#${esc(o.code)}</strong> · ${esc(o.customer_name)}<br><small class="muted">${fmtDateTime(o.created_at)}</small></div>
          <select data-status aria-label="Estado del pedido" class="status-select status--${o.status}">
            ${Object.entries(ORDER_STATUS).map(([k, v]) => `<option value="${k}" ${k === o.status ? 'selected' : ''}>${v}</option>`).join('')}
          </select>
        </header>
        <ul>${o.items.map((l) => `<li><span>${l.qty}x ${esc(l.name)}${l.day_name ? ` <em>(${esc(l.day_name)})</em>` : ''}</span><span>${money(l.subtotal)}</span></li>`).join('')}
          ${o.delivery_cost ? `<li><span>Envío</span><span>${money(o.delivery_cost)}</span></li>` : ''}
          <li class="total"><span>Total</span><span>${money(o.total)}</span></li></ul>
        <p class="order__meta">${o.delivery_method === 'envio' ? `🛵 Envío: ${esc(o.address)}${o.zone_name ? ` (${esc(o.zone_name)})` : ''}` : '🏪 Retira en el local'}
          ${o.payment_method ? ` · 💳 ${esc(o.payment_method)}` : ''}${o.notes ? `<br>📝 ${esc(o.notes)}` : ''}</p>
        <button class="btn btn--sm btn--ghost" data-copy>Copiar mensaje</button>
      </article>`).join('')}
    </div>`;
  $('#oList').addEventListener('change', async (e) => {
    if (!e.target.matches('[data-status]')) return;
    const id = e.target.closest('[data-id]').dataset.id;
    try { await api('PATCH', `/orders/${id}`, { status: e.target.value }); e.target.className = `status-select status--${e.target.value}`; toast('Estado actualizado'); }
    catch (err) { toast(err.message, 'error'); }
  });
  $('#oList').addEventListener('click', async (e) => {
    if (!e.target.matches('[data-copy]')) return;
    const o = orders.find((x) => String(x.id) === e.target.closest('[data-id]').dataset.id);
    try { await navigator.clipboard.writeText(o.message); toast('Mensaje copiado'); } catch { toast('No se pudo copiar', 'error'); }
  });
};

// =================================================================== CONFIGURACIÓN
routes.config = async () => {
  const [s, zones] = await Promise.all([getSettings(true), api('GET', '/zones')]);
  const hours = s.business_hours || [];
  main.innerHTML = `
    <header class="page-head"><div><h1>Configuración</h1><p class="muted">Datos del negocio que se muestran en la tienda.</p></div></header>
    <nav class="subnav">
      <a href="#cfg-wa">WhatsApp</a><a href="#cfg-pedidos">Pedidos</a><a href="#cfg-negocio">Negocio</a>
      <a href="#cfg-horarios">Horarios</a><a href="#cfg-entregas">Entregas</a><a href="#cfg-zonas">Zonas</a>
    </nav>

    <form class="card cfg" id="cfg-wa" data-section>
      <h2>💬 WhatsApp y contacto</h2>
      <label class="field"><span>Número de WhatsApp que recibe los pedidos *</span>
        <input name="whatsapp" inputmode="tel" value="${esc(s.whatsapp || '')}" placeholder="Ej: 5491112345678">
        <small class="muted">Con código de país, sin espacios ni signos. Argentina: <b>54 9</b> + característica sin 0 + número sin 15. Ej: 11 1234-5678 → <b>5491112345678</b>.</small>
      </label>
      <p><a href="#" id="waTest" class="btn btn--ghost btn--sm" target="_blank" rel="noopener">Probar número ↗</a></p>
      <div class="grid-2">
        <label class="field"><span>Teléfono</span><input name="phone" value="${esc(s.phone || '')}" maxlength="40"></label>
        <label class="field"><span>Email</span><input name="email" type="email" value="${esc(s.email || '')}" maxlength="120"></label>
        <label class="field"><span>Instagram</span><input name="instagram" value="${esc(s.instagram || '')}" placeholder="usuario (sin @)" maxlength="80"></label>
        <label class="field"><span>Dirección</span><input name="address" value="${esc(s.address || '')}" maxlength="200"></label>
      </div>
      <button class="btn btn--primary">Guardar</button>
    </form>

    <form class="card cfg" id="cfg-pedidos" data-section>
      <h2>🧾 Pedidos</h2>
      ${switchHTML('name="orders_enabled"', s.orders_enabled, '<strong>Recibir pedidos online</strong> — desactivalo para pausar la tienda (vacaciones, sin stock, etc.)')}
      ${switchHTML('name="accept_orders_when_closed"', s.accept_orders_when_closed, 'Permitir pedidos fuera del horario de atención (para encargar con anticipación)')}
      <div class="field"><span>Días en que ofrecés viandas (columnas del menú semanal)</span>
        <div class="chips-row">${[1, 2, 3, 4, 5, 6, 7].map((d) => `<label class="mini-check"><input type="checkbox" name="service_days" value="${d}" ${(s.service_days || []).includes(d) ? 'checked' : ''}>${DAYS[d]}</label>`).join('')}</div>
      </div>
      <label class="field"><span>Formas de pago <small class="muted">(una por línea; dejá vacío para no preguntar)</small></span>
        <textarea name="payment_methods" rows="3">${esc((s.payment_methods || []).join('\n'))}</textarea></label>
      <button class="btn btn--primary">Guardar</button>
    </form>

    <form class="card cfg" id="cfg-negocio" data-section>
      <h2>🏠 Negocio</h2>
      <div class="grid-2">
        <label class="field"><span>Nombre del emprendimiento *</span><input name="business_name" required maxlength="80" value="${esc(s.business_name || '')}"></label>
        <label class="field"><span>Frase de bienvenida</span><input name="slogan" maxlength="120" value="${esc(s.slogan || '')}"></label>
      </div>
      <label class="field"><span>Presentación</span><textarea name="about" rows="4" maxlength="1500">${esc(s.about || '')}</textarea></label>
      <div class="grid-2 images">
        ${['logo', 'hero_image'].map((k) => `
        <div class="field image-up" data-image="${k}">
          <span>${k === 'logo' ? 'Logo' : 'Imagen principal (portada)'}</span>
          <img src="${esc(s[k] || (k === 'logo' ? '/img/logo.svg' : PLACEHOLDER))}" alt="" class="${k === 'logo' ? 'is-logo' : ''}">
          <div class="btn-group">
            <label class="btn btn--ghost btn--sm">📷 Subir<input type="file" accept="image/*" hidden data-upload="${k}"></label>
            ${s[k] ? `<button type="button" class="btn btn--ghost btn--sm" data-remove="${k}">Quitar</button>` : ''}
          </div>
        </div>`).join('')}
      </div>
      <button class="btn btn--primary">Guardar</button>
    </form>

    <form class="card cfg" id="cfg-horarios" data-section>
      <h2>🕒 Horarios de atención</h2>
      <div class="hours-edit">
        ${[1, 2, 3, 4, 5, 6, 7].map((d) => {
          const h = hours.find((x) => x.day === d) || { enabled: false, open: '09:00', close: '18:00' };
          return `<div class="hours-row" data-day="${d}">
            ${switchHTML(`data-h="enabled"`, h.enabled, DAYS[d])}
            <input type="time" data-h="open" value="${esc(h.open)}" aria-label="Abre ${DAYS[d]}">
            <span>a</span>
            <input type="time" data-h="close" value="${esc(h.close)}" aria-label="Cierra ${DAYS[d]}">
          </div>`;
        }).join('')}
      </div>
      <label class="field"><span>Aclaración <small class="muted">(opcional)</small></span><input name="hours_note" maxlength="300" value="${esc(s.hours_note || '')}" placeholder="Ej: Feriados cerrado"></label>
      <button class="btn btn--primary">Guardar</button>
    </form>

    <form class="card cfg" id="cfg-entregas" data-section>
      <h2>🛵 Envíos y retiros</h2>
      ${switchHTML('name="delivery_enabled"', s.delivery_enabled, '<strong>Envío a domicilio</strong>')}
      <label class="field"><span>Información de envíos</span><textarea name="delivery_info" rows="2" maxlength="600">${esc(s.delivery_info || '')}</textarea></label>
      <label class="field"><span>Pedido mínimo para envío <small class="muted">(0 = sin mínimo)</small></span>
        <div class="input-prefix"><b>$</b><input name="min_order" inputmode="numeric" value="${s.min_order || 0}"></div></label>
      <hr>
      ${switchHTML('name="pickup_enabled"', s.pickup_enabled, '<strong>Retiro en el local</strong>')}
      <label class="field"><span>Dirección de retiro</span><input name="pickup_address" maxlength="200" value="${esc(s.pickup_address || '')}"></label>
      <label class="field"><span>Información de retiro</span><textarea name="pickup_info" rows="2" maxlength="600">${esc(s.pickup_info || '')}</textarea></label>
      <button class="btn btn--primary">Guardar</button>
    </form>

    <section class="card cfg" id="cfg-zonas">
      <h2>📍 Zonas de entrega</h2>
      <p class="muted">El cliente elige su zona y el costo se suma automáticamente al total. Si no cargás zonas, el envío figura "a coordinar".</p>
      <div id="zonesBox"></div>
      <form class="inline-form" id="zoneAdd">
        <input name="name" placeholder="Nombre de la zona" maxlength="80" required aria-label="Nombre de la zona">
        <div class="input-prefix"><b>$</b><input name="cost" inputmode="numeric" placeholder="Costo" aria-label="Costo de envío" required></div>
        <button class="btn btn--primary">Agregar</button>
      </form>
    </section>`;

  // Probar WhatsApp
  const waInput = $('#cfg-wa [name=whatsapp]');
  const updateWaTest = () => { $('#waTest').href = `https://wa.me/${waInput.value.replace(/\D/g, '')}?text=${encodeURIComponent('Prueba desde el panel de la tienda ✔')}`; };
  waInput.addEventListener('input', updateWaTest); updateWaTest();

  // Guardado por sección
  $$('form[data-section]').forEach((form) => form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const body = {};
    for (const el of f.elements) {
      if (!el.name || el.type === 'file') continue;
      if (el.name === 'service_days') continue;
      if (el.name === 'payment_methods') body.payment_methods = el.value.split('\n').map((x) => x.trim()).filter(Boolean);
      else if (el.type === 'checkbox') body[el.name] = el.checked;
      else body[el.name] = el.value.trim();
    }
    if (f.id === 'cfg-pedidos') body.service_days = $$('[name=service_days]:checked', f).map((x) => Number(x.value));
    if (f.id === 'cfg-horarios') {
      body.business_hours = $$('.hours-row', f).map((r) => ({
        day: Number(r.dataset.day), enabled: $('[data-h=enabled]', r).checked, open: $('[data-h=open]', r).value, close: $('[data-h=close]', r).value,
      }));
    }
    if (body.min_order !== undefined) body.min_order = body.min_order.replace(/[.\s$]/g, '') || 0;
    const btn = f.querySelector('button.btn--primary');
    btn.disabled = true;
    try {
      cache.settings = await api('PUT', '/settings', body);
      toast('Guardado ✔');
      if (f.id === 'cfg-negocio') updateSidebar();
    } catch (err) { toast(err.message, 'error'); }
    finally { btn.disabled = false; }
  }));

  // Imágenes
  $('#cfg-negocio').addEventListener('change', async (e) => {
    const k = e.target.dataset.upload;
    if (!k || !e.target.files[0]) return;
    const fd = new FormData();
    fd.append('image', e.target.files[0]);
    toast('Subiendo imagen…');
    try { await api('POST', `/settings/image/${k}`, fd); toast('Imagen actualizada ✔'); await getSettings(true); updateSidebar(); routes.config(); }
    catch (err) { toast(err.message, 'error'); }
  });
  $('#cfg-negocio').addEventListener('click', async (e) => {
    const k = e.target.dataset.remove;
    if (!k) return;
    try { await api('DELETE', `/settings/image/${k}`); toast('Imagen quitada'); await getSettings(true); updateSidebar(); routes.config(); }
    catch (err) { toast(err.message, 'error'); }
  });

  // Zonas
  function renderZones(list) {
    $('#zonesBox').innerHTML = list.length === 0 ? '<p class="muted">No hay zonas cargadas.</p>' : `
      <div class="zones-edit">${list.map((z) => `
        <div class="zone-row" data-id="${z.id}">
          <input value="${esc(z.name)}" data-z="name" maxlength="80" aria-label="Nombre de la zona">
          <div class="input-prefix"><b>$</b><input value="${z.cost}" data-z="cost" inputmode="numeric" aria-label="Costo"></div>
          ${switchHTML('data-z="active" aria-label="Activa"', z.active, 'Activa')}
          <button type="button" class="btn btn--sm btn--ghost" data-zact="save">Guardar</button>
          <button type="button" class="btn btn--sm btn--ghost btn--icon" data-zact="del" aria-label="Eliminar">🗑</button>
        </div>`).join('')}</div>`;
  }
  renderZones(zones);
  const reloadZones = async () => renderZones(await api('GET', '/zones'));
  $('#zoneAdd').onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api('POST', '/zones', { name: e.target.name.value.trim(), cost: e.target.cost.value.replace(/[.\s$]/g, '') });
      e.target.reset(); toast('Zona agregada'); reloadZones();
    } catch (err) { toast(err.message, 'error'); }
  };
  $('#zonesBox').onclick = async (e) => {
    const act = e.target.dataset.zact;
    if (!act) return;
    const row = e.target.closest('[data-id]');
    try {
      if (act === 'save') {
        await api('PUT', `/zones/${row.dataset.id}`, {
          name: $('[data-z=name]', row).value.trim(), cost: $('[data-z=cost]', row).value.replace(/[.\s$]/g, ''), active: $('[data-z=active]', row).checked,
        });
        toast('Zona guardada');
      } else if (act === 'del') {
        if (!(await confirmDialog('¿Eliminar esta zona de entrega?'))) return;
        await api('DELETE', `/zones/${row.dataset.id}`); toast('Zona eliminada'); reloadZones();
      }
    } catch (err) { toast(err.message, 'error'); }
  };
  $('#zonesBox').onchange = async (e) => {
    if (!e.target.matches('[data-z=active]')) return;
    const row = e.target.closest('[data-id]');
    row.querySelector('[data-zact=save]').click();
  };
};

// =================================================================== CUENTA
routes.cuenta = async () => {
  const [me, admins] = await Promise.all([api('GET', '/me'), api('GET', '/admins')]);
  main.innerHTML = `
    <header class="page-head"><div><h1>Cuenta</h1><p class="muted">Ingresaste como <strong>${esc(me.username)}</strong>.</p></div></header>
    <form class="card" id="pwForm" novalidate>
      <h2>Cambiar contraseña</h2>
      <input type="text" name="username" value="${esc(me.username)}" autocomplete="username" hidden>
      <label class="field"><span>Contraseña actual</span><input type="password" name="current" autocomplete="current-password" required></label>
      <div class="grid-2">
        <label class="field"><span>Nueva contraseña</span><input type="password" name="password" autocomplete="new-password" minlength="8" required></label>
        <label class="field"><span>Repetir nueva contraseña</span><input type="password" name="password2" autocomplete="new-password" required></label>
      </div>
      <button class="btn btn--primary">Cambiar contraseña</button>
    </form>
    <section class="card">
      <h2>Administradores</h2>
      <div class="list">${admins.map((a) => `
        <div class="row-card row-card--compact" data-id="${a.id}">
          <div class="row-card__main"><h3>${esc(a.username)} ${a.id === me.id ? '<span class="pill pill--ok">Vos</span>' : ''}</h3>
          <p class="muted">${a.last_login ? `Último ingreso: ${fmtDateTime(a.last_login)}` : 'Nunca ingresó'}</p></div>
          ${a.id !== me.id ? '<button class="btn btn--sm btn--ghost" data-del>Eliminar</button>' : ''}
        </div>`).join('')}</div>
      <form class="inline-form" id="adminAdd" novalidate>
        <input name="username" placeholder="Usuario" autocomplete="off" required aria-label="Usuario nuevo">
        <input name="password" type="password" placeholder="Contraseña (mín. 8)" autocomplete="new-password" required aria-label="Contraseña">
        <button class="btn btn--primary">Agregar</button>
      </form>
    </section>
    <button class="btn btn--ghost" id="logout2">Cerrar sesión</button>`;
  $('#pwForm').onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target;
    if (f.password.value !== f.password2.value) return toast('Las contraseñas nuevas no coinciden', 'error');
    try { await api('POST', '/password', { current: f.current.value, password: f.password.value }); f.reset(); toast('Contraseña actualizada ✔'); }
    catch (err) { toast(err.message, 'error'); }
  };
  $('#adminAdd').onsubmit = async (e) => {
    e.preventDefault();
    try { await api('POST', '/admins', { username: e.target.username.value.trim(), password: e.target.password.value }); toast('Administrador agregado'); routes.cuenta(); }
    catch (err) { toast(err.message, 'error'); }
  };
  main.querySelector('.list').onclick = async (e) => {
    if (!e.target.matches('[data-del]')) return;
    if (!(await confirmDialog('¿Eliminar este administrador? Ya no podrá ingresar al panel.'))) return;
    try { await api('DELETE', `/admins/${e.target.closest('[data-id]').dataset.id}`); toast('Administrador eliminado'); routes.cuenta(); }
    catch (err) { toast(err.message, 'error'); }
  };
  $('#logout2').onclick = logout;
};

// ----------------------------------------------------------------- general
async function logout() {
  try { await api('POST', '/logout'); } catch { /* igual salimos */ }
  location.href = '/admin/login';
}
async function updateSidebar() {
  try {
    const s = await getSettings();
    $('#sideName').textContent = s.business_name;
    $('#sideLogo').src = s.logo || '/img/logo.svg';
  } catch { /* no crítico */ }
}
$('#logoutBtn').onclick = logout;
$('#moreBtn').onclick = () => { $('#moreMenu').hidden = !$('#moreMenu').hidden; };
document.addEventListener('click', (e) => { if (!e.target.closest('#moreBtn, #moreMenu')) $('#moreMenu').hidden = true; });

updateSidebar();
router();
