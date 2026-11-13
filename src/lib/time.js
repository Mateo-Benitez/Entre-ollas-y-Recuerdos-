'use strict';
const config = require('../config');

const DAY_NAMES = ['Toda la semana', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
const WEEKDAY_MAP = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

/** Fecha/hora actual en la zona horaria del negocio. */
function now(date = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: config.timeZone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23',
    }).formatToParts(date).map((p) => [p.type, p.value])
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
    weekday: WEEKDAY_MAP[parts.weekday],
  };
}

/** Indica si el negocio está abierto según los horarios configurados. */
function openStatus(hours, at = now()) {
  const today = (hours || []).find((h) => h.day === at.weekday);
  const isOpen = !!(today && today.enabled && at.time >= today.open && at.time < today.close);
  return { isOpen, today: today || null, weekday: at.weekday };
}

module.exports = { now, openStatus, DAY_NAMES };
