import { fetchResumenDiario, insertOutbox, getState, setState, getConfig } from './database.js';
import { config } from '../config.js';

const STATE_KEY = 'lastResumenDate';

async function leerConfigResumen() {
  const enabled = String(await getConfig('resumen.enabled', config.resumen.enabled ? 'true' : 'false')) !== 'false';
  const hour = Number(await getConfig('resumen.hora', config.resumen.hour));
  const minute = Number(await getConfig('resumen.minuto', config.resumen.minute));
  const recipients = String(
    await getConfig('resumen.recipientes', (config.resumen.recipients ?? []).join(','))
  )
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return { enabled, hour, minute, recipients };
}

function toYMD(date) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

function parseYMD(str) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str ?? '');
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0, 0);
}

function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

export async function maybeEnviarResumen() {
  const c = await leerConfigResumen();
  if (!c.enabled) return;

  const now = new Date();
  const target = new Date(now);
  target.setHours(c.hour, c.minute, 0, 0);
  if (now < target) return;

  const hoy = toYMD(now);

  let last;
  try {
    last = await getState(STATE_KEY);
  } catch (err) {
    console.error('[Resumen] No se pudo leer el estado:', err.message);
    return;
  }
  if (last === hoy) return;

  const dias = diasPendientes(last, hoy);
  if (dias.length === 0) return;

  for (const dia of dias) {
    const desde = parseYMD(dia);
    const hasta = addDays(desde, 1);

    let data;
    try {
      data = await fetchResumenDiario(desde, hasta);
    } catch (err) {
      console.error(`[Resumen] Error al consultar facturas del ${dia}:`, err.message);
      return;
    }

    const esHoy = dia === hoy;
    const sinMovimientos =
      (Number(data.total?.Total) || 0) === 0 && (Number(data.total?.Borradas) || 0) === 0;

    if (!esHoy && sinMovimientos) {
      await setState(STATE_KEY, dia);
      continue;
    }

    const msg = buildMensaje(data, desde);

    for (const tlf of c.recipients) {
      try {
        await insertOutbox(tlf, msg);
      } catch (err) {
        console.error(`[Resumen] No se pudo encolar el ${dia} a ${tlf}:`, err.message);
        return;
      }
    }

    await setState(STATE_KEY, dia);
    const etiqueta = esHoy ? 'encolado' : 'encolado (recuperado)';
    console.log(
      `[Resumen] Resumen del ${dia} ${etiqueta} para ${c.recipients.length} movil(es)`
    );
  }
}

function diasPendientes(last, hoy) {
  const inicio = last ? parseYMD(last) : null;
  const hasta = parseYMD(hoy);
  if (!inicio) return [hoy];

  const resultado = [];
  let cursor = addDays(inicio, 1);
  while (toYMD(cursor) <= hoy && resultado.length < config.resumen.catchupDays) {
    resultado.push(toYMD(cursor));
    cursor = addDays(cursor, 1);
  }
  return resultado;
}

export function buildMensaje(data, desde, { elimInadas = true } = {}) {
  const t = data.total ?? {};
  const fecha = desde.toLocaleDateString('es-ES');

  const total = Number(t.Total) || 0;
  const borradas = Number(t.Borradas) || 0;
  const sinMovimientos = total === 0 && borradas === 0;

  if (sinMovimientos) {
    return (
      `FACTURAS INTRODUCIDAS EN REFACT DIA ${fecha}\n\n` +
      `Sin movimientos en el programa este dia.`
    );
  }

  const euros = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' });
  const fmt = (v) => euros.format(Number(v) || 0);
  const lineas = [];

  lineas.push(`FACTURAS INTRODUCIDAS EN REFACT DIA ${fecha}`);
  lineas.push('');

  for (const e of data.porEstado ?? []) {
    lineas.push(`${e.EstadoDesc || 'sin estado'}: ${e.N} - ${fmt(e.Suma)}`);
  }

  lineas.push('');
  lineas.push(`TOTAL: ${total} - ${fmt(t.Suma)}`);

  if (elimInadas && borradas > 0) {
    lineas.push(`ELIMINADAS: ${borradas}`);
  }

  return lineas.join('\n');
}