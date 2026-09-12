import {
  fetchSourceRows,
  insertOutbox,
  getState,
  setState,
} from './database.js';
import { config } from '../config.js';

const STATE_KEY = 'lastSourceId';

export async function ingestSource() {
  const { idColumn, phoneColumn, messageTemplate } = config.source;

  let lastId = 0;
  try {
    lastId = Number(await getState(STATE_KEY)) || 0;
  } catch (err) {
    console.error('[Ingest] No se pudo leer el estado:', err.message);
    return;
  }

  let rows;
  try {
    rows = await fetchSourceRows(lastId);
  } catch (err) {
    console.error('[Ingest] Error al leer la fuente:', err.message);
    return;
  }
  if (!rows.length) return;

  let maxId = lastId;
  let added = 0;

  for (const row of rows) {
    const rawId = row[idColumn];
    const numericId = Number(rawId);
    if (!Number.isFinite(numericId)) continue;

    const phone = row[phoneColumn];
    const message = buildMessage(row, messageTemplate);

    if (phone && message) {
      try {
        await insertOutbox(String(phone), message);
        added += 1;
      } catch (err) {
        console.error(`[Ingest] error en fila ${rawId}:`, err.message);
      }
    }

    if (numericId > maxId) maxId = numericId;
  }

  if (maxId > lastId) {
    await setState(STATE_KEY, maxId);
  }

  console.log(`[Ingest] ${added} mensaje(s) nuevos en la cola (hasta Id ${maxId})`);
}

export function buildMessage(row, template) {
  if (!template) return JSON.stringify(row);
  return template.replace(/\{(\w+)\}/g, (match, name) => row[name] ?? match);
}