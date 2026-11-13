'use strict';

/** Limitador de peticiones simple por IP, en memoria. */
module.exports = function rateLimit({ windowMs, max }) {
  const hits = new Map();
  setInterval(() => {
    const t = Date.now();
    for (const [k, v] of hits) if (t - v.start > windowMs) hits.delete(k);
  }, windowMs).unref();

  return (req, res, next) => {
    const key = req.ip;
    const t = Date.now();
    let h = hits.get(key);
    if (!h || t - h.start > windowMs) { h = { start: t, count: 0 }; hits.set(key, h); }
    if (++h.count > max) {
      return res.status(429).json({ error: 'Demasiados intentos. Esperá unos minutos y volvé a probar.' });
    }
    next();
  };
};
