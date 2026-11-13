'use strict';
const { db } = require('./db');
const { createAdmin } = require('./auth');

/**
 * Si no existe ningún administrador y están definidas ADMIN_USER y ADMIN_PASSWORD,
 * crea el primero automáticamente (útil en hostings donde no hay consola).
 */
module.exports = async function bootstrapAdmin() {
  const n = db.prepare('SELECT COUNT(*) n FROM admins').get().n;
  const { ADMIN_USER, ADMIN_PASSWORD } = process.env;
  if (n === 0 && ADMIN_USER && ADMIN_PASSWORD) {
    try {
      await createAdmin(ADMIN_USER, ADMIN_PASSWORD);
      console.log(`✔ Administrador "${ADMIN_USER}" creado desde variables de entorno.`);
    } catch (e) {
      console.error('✖ No se pudo crear el administrador inicial:', e.message);
    }
  }
};
