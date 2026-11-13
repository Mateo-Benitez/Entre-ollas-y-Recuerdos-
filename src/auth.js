'use strict';
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { db } = require('./db');
const config = require('./config');

const COOKIE = 'sid';
const DUMMY_HASH = bcrypt.hashSync('no-user-placeholder', 12);
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function createSession(res, adminId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = Date.now() + config.sessionDays * 864e5;
  db.prepare('INSERT INTO sessions (token_hash, admin_id, expires_at) VALUES (?, ?, ?)').run(sha256(token), adminId, expires);
  db.prepare("UPDATE admins SET last_login = datetime('now') WHERE id = ?").run(adminId);
  res.cookie(COOKIE, token, {
    httpOnly: true, sameSite: 'lax', secure: config.isProd, path: '/', maxAge: config.sessionDays * 864e5,
  });
}

function destroySession(req, res) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
  res.clearCookie(COOKIE, { path: '/' });
}

function getAdmin(req) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (!token) return null;
  const row = db.prepare(`
    SELECT a.id, a.username, s.expires_at FROM sessions s JOIN admins a ON a.id = s.admin_id
    WHERE s.token_hash = ?
  `).get(sha256(token));
  if (!row) return null;
  if (row.expires_at < Date.now()) {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
    return null;
  }
  return { id: row.id, username: row.username };
}

/** Protege la API de administración. */
function requireAdmin(req, res, next) {
  const admin = getAdmin(req);
  if (!admin) return res.status(401).json({ error: 'Sesión expirada. Volvé a ingresar.' });
  // Protección CSRF: las operaciones que modifican datos deben venir del propio panel (fetch con header propio).
  if (req.method !== 'GET' && req.get('X-Requested-With') !== 'fetch') {
    return res.status(403).json({ error: 'Solicitud no permitida.' });
  }
  req.admin = admin;
  next();
}

// --- Limitador de intentos de login (en memoria) ---
const attempts = new Map();
const WINDOW = 15 * 60 * 1000;
const MAX_FAILS = 5;
function loginBlocked(key) {
  const a = attempts.get(key);
  if (!a) return false;
  if (Date.now() - a.first > WINDOW) { attempts.delete(key); return false; }
  return a.count >= MAX_FAILS;
}
function registerFail(key) {
  const a = attempts.get(key);
  if (!a || Date.now() - a.first > WINDOW) attempts.set(key, { count: 1, first: Date.now() });
  else a.count++;
}
function clearFails(key) { attempts.delete(key); }

async function login(username, password) {
  const admin = db.prepare('SELECT * FROM admins WHERE username = ?').get(String(username || '').trim());
  // Comparamos aunque el usuario no exista para no revelar qué usuarios existen por tiempo de respuesta.
  const hash = admin ? admin.password_hash : DUMMY_HASH;
  const ok = await bcrypt.compare(String(password || ''), hash);
  return ok && admin ? admin : null;
}

function validatePassword(pw) {
  if (typeof pw !== 'string' || pw.length < 8) return 'La contraseña debe tener al menos 8 caracteres.';
  if (pw.length > 128) return 'La contraseña es demasiado larga.';
  return null;
}

async function createAdmin(username, password) {
  username = String(username || '').trim();
  if (!/^[a-zA-Z0-9._-]{3,32}$/.test(username)) {
    throw Object.assign(new Error('El usuario debe tener entre 3 y 32 caracteres (letras, números, punto, guion).'), { status: 400 });
  }
  const err = validatePassword(password);
  if (err) throw Object.assign(new Error(err), { status: 400 });
  const hash = await bcrypt.hash(password, 12);
  try {
    return db.prepare('INSERT INTO admins (username, password_hash) VALUES (?, ?)').run(username, hash).lastInsertRowid;
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) throw Object.assign(new Error('Ese usuario ya existe.'), { status: 400 });
    throw e;
  }
}

async function changePassword(adminId, newPassword) {
  const err = validatePassword(newPassword);
  if (err) throw Object.assign(new Error(err), { status: 400 });
  const hash = await bcrypt.hash(newPassword, 12);
  db.prepare('UPDATE admins SET password_hash = ? WHERE id = ?').run(hash, adminId);
}

// Limpieza periódica de sesiones vencidas
setInterval(() => db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now()), 3600e3).unref();

module.exports = {
  createSession, destroySession, getAdmin, requireAdmin, login, createAdmin, changePassword,
  loginBlocked, registerFail, clearFails, bcrypt,
};
