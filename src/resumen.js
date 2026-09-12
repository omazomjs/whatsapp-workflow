import { fetchResumenDiario, insertOutbox, getState, setState } from './database.js';
import { config } from '../config.js';

const STATE_KEY = 'lastResumenDate';

function toYMD(date) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

export async function maybeEnviarResumen() {
  if (!config.resumen.enabled) return;

  const now = new Date();
  const target = new Date(now);
  target.setHours(config.resumen.hour, config.resumen.minute, 0, 0);
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

  const desde = new Date(now);
  desde.setHours(0, 0, 0, 0);
  const hasta = new Date(desde);
  hasta.setDate(hasta.getDate() + 1);

  let data;
  try {
    data = await fetchResumenDiario(desde, hasta);
  } catch (err) {
    console.error('[Resumen] Error al consultar las facturas:', err.message);
    return;
  }

  const msg = buildMensaje(data, desde);

  for (const tlf of config.resumen.recipients) {
    try {
      await insertOutbox(tlf, msg);
    } catch (err) {
      console.error(`[Resumen] No se pudo encolar a ${tlf}:`, err.message);
      return;
    }
  }

  await setState(STATE_KEY, hoy);
  console.log(`[Resumen] Resumen del ${hoy} encolado para ${config.resumen.recipients.length} movil(es)`);
}

export function buildMensaje(data, desde) {
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

  if (borradas > 0) {
    lineas.push(`ELIMINADAS: ${borradas}`);
  }

  return lineas.join('\n');
}