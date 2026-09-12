import { fetchPending, markSent, markFailed } from './database.js';
import { config } from '../config.js';

export async function processOutbox(client) {
  let rows;
  try {
    rows = await fetchPending(config.polling.batchSize, config.polling.outboxTable);
  } catch (err) {
    console.error('[DB] Error al consultar la cola:', err.message);
    return;
  }

  if (rows.length === 0) return;

  for (const row of rows) {
    const number = normalizeNumber(row.Phone);
    if (!number) {
      console.error(`[Outbox] id=${row.Id}: numero invalido (${row.Phone})`);
      await markFailed(row.Id, 'Numero invalido');
      continue;
    }

    try {
      await client.sendMessage(`${number}@c.us`, row.Message);
      await markSent(row.Id);
      console.log(`[Enviado] id=${row.Id} -> ${number}`);
    } catch (err) {
      console.error(`[Error] id=${row.Id} -> ${number}: ${err.message}`);
      await markFailed(row.Id, err.message);
    }
  }
}

export function normalizeNumber(phone) {
  const digits = String(phone ?? '').replace(/\D/g, '');
  return digits.startsWith('00') ? digits.slice(2) : digits;
}