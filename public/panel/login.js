document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const err = document.getElementById('err');
  const btn = f.querySelector('button');
  err.hidden = true;
  if (!f.username.value.trim() || !f.password.value) {
    err.textContent = 'Completá usuario y contraseña.';
    err.hidden = false;
    return;
  }
  btn.disabled = true;
  btn.textContent = 'Ingresando…';
  try {
    const res = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: f.username.value.trim(), password: f.password.value }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'No se pudo ingresar.');
    location.href = '/admin';
  } catch (ex) {
    err.textContent = ex.message === 'Failed to fetch' ? 'Sin conexión. Intentá de nuevo.' : ex.message;
    err.hidden = false;
    f.password.value = '';
    f.password.focus();
  } finally {
    btn.disabled = false;
    btn.textContent = 'Ingresar';
  }
});
