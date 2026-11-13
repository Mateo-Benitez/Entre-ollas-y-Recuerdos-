'use strict';
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const config = require('./config');
const { db } = require('./db');
const auth = require('./auth');
const bootstrapAdmin = require('./bootstrap');

const app = express();
if (config.trustProxy) app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      'img-src': ["'self'", 'data:', 'blob:'],
      'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      'font-src': ["'self'", 'https://fonts.gstatic.com'],
      'upgrade-insecure-requests': config.isProd ? [] : null,
    },
  },
  crossOriginEmbedderPolicy: false,
}));
app.use(express.json({ limit: '200kb' }));

const PUBLIC = path.join(config.ROOT, 'public');
const VIEWS = path.join(config.ROOT, 'views');

// API
app.use('/api', require('./routes/public'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api', (req, res) => res.status(404).json({ error: 'Ruta no encontrada.' }));

// Panel de administración: la página solo se entrega con sesión válida
const noStore = (res) => res.set('Cache-Control', 'no-store');
app.get(['/admin', '/admin/'], (req, res) => {
  noStore(res);
  if (!auth.getAdmin(req)) return res.redirect('/admin/login');
  res.sendFile(path.join(VIEWS, 'admin.html'));
});
app.get('/admin/login', (req, res) => {
  noStore(res);
  if (auth.getAdmin(req)) return res.redirect('/admin');
  res.sendFile(path.join(VIEWS, 'login.html'));
});

// Archivos estáticos
app.use('/uploads', express.static(config.uploadDir, { maxAge: '30d', immutable: true, index: false }));
app.use(express.static(PUBLIC, { maxAge: config.isProd ? '1h' : 0, index: 'index.html' }));

app.use((req, res) => res.status(404).sendFile(path.join(PUBLIC, 'index.html')));

// Manejo de errores centralizado
app.use((err, req, res, _next) => {
  let status = err.status || err.statusCode || 500;
  let message = err.message;
  if (err.code === 'LIMIT_FILE_SIZE') { status = 400; message = 'La imagen es demasiado pesada (máximo 10 MB).'; }
  else if (err.type === 'entity.parse.failed') { status = 400; message = 'Datos inválidos.'; }
  if (status >= 500) {
    console.error(err);
    message = 'Ocurrió un error inesperado. Intentá nuevamente.';
  }
  res.status(status).json({ error: message, field: err.field });
});

bootstrapAdmin().then(() => {
  app.listen(config.port, () => {
    console.log(`✔ Tienda online en http://localhost:${config.port}`);
    console.log(`✔ Panel de administración en http://localhost:${config.port}/admin`);
    const admins = db.prepare('SELECT COUNT(*) n FROM admins').get().n;
    if (!admins) console.warn('⚠ No hay administradores. Creá uno con: npm run create-admin');
  });
});
