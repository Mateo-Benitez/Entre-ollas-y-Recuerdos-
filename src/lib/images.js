'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const sharp = require('sharp');
const config = require('../config');

const ALLOWED = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'image/avif'];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 30 },
  fileFilter: (req, file, cb) => {
    if (ALLOWED.includes(file.mimetype)) cb(null, true);
    else cb(Object.assign(new Error('Formato de imagen no permitido. Usá JPG, PNG o WEBP.'), { status: 400 }));
  },
});

/**
 * Optimiza y guarda una imagen subida. Se re-codifica siempre con sharp, lo que
 * además descarta cualquier contenido que no sea una imagen real.
 */
async function saveImage(buffer, { maxWidth = 1200, maxHeight = 1200, prefix = 'img' } = {}) {
  let out;
  try {
    out = await sharp(buffer, { failOn: 'error' })
      .rotate() // respeta la orientación de las fotos del celular
      .resize({ width: maxWidth, height: maxHeight, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer();
  } catch {
    throw Object.assign(new Error('No se pudo procesar la imagen. Probá con otra foto.'), { status: 400 });
  }
  const name = `${prefix}-${Date.now()}-${crypto.randomBytes(6).toString('hex')}.webp`;
  await fs.promises.writeFile(path.join(config.uploadDir, name), out);
  return `/uploads/${name}`;
}

function deleteImage(url) {
  if (!url || typeof url !== 'string') return;
  const m = url.match(/^\/uploads\/([a-z]+-\d+-[a-f0-9]+\.webp)$/);
  if (!m) return;
  fs.promises.unlink(path.join(config.uploadDir, m[1])).catch(() => {});
}

module.exports = { upload, saveImage, deleteImage };
