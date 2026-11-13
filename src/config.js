'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

// Carga simple de .env (sin dependencias). Las variables ya definidas en el entorno tienen prioridad.
const envFile = path.join(ROOT, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!m || line.trim().startsWith('#')) continue;
    const key = m[1];
    let val = m[2];
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

const dataDir = path.resolve(ROOT, process.env.DATA_DIR || 'data');

module.exports = {
  ROOT,
  port: Number(process.env.PORT) || 3000,
  isProd: process.env.NODE_ENV === 'production',
  dataDir,
  dbPath: path.join(dataDir, 'viandas.db'),
  uploadDir: path.join(dataDir, 'uploads'),
  timeZone: process.env.TIMEZONE || 'America/Argentina/Buenos_Aires',
  sessionDays: Number(process.env.SESSION_DAYS) || 7,
  // Si la app corre detrás de un proxy (Render, Railway, Nginx) para obtener la IP real y cookies seguras
  trustProxy: process.env.TRUST_PROXY === '1' || process.env.TRUST_PROXY === 'true',
};
