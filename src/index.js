import { createClient } from './whatsapp.js';
import { promptPassword } from './prompt.js';
import { ingestSource } from './ingest.js';
import { maybeEnviarResumen } from './resumen.js';
import { processOutbox } from './outbox.js';
import { closePool } from './database.js';
import { config } from '../config.js';

let timer = null;
let shuttingDown = false;

async function tick(client) {
  if (config.source.enabled) {
    try {
      await ingestSource();
    } catch (err) {
      console.error('[Workflow] Error al leer la fuente:', err.message);
    }
  }
  try {
    await maybeEnviarResumen();
  } catch (err) {
    console.error('[Workflow] Error en el resumen diario:', err.message);
  }
  try {
    await processOutbox(client);
  } catch (err) {
    console.error('[Workflow] Error al procesar la cola:', err.message);
  }
}

function startPolling(client) {
  console.log(
    `[Workflow] Ciclo cada ${config.polling.intervalMs / 1000}s: lee fuente -> cola -> envia`
  );
  void tick(client);
  timer = setInterval(() => tick(client), config.polling.intervalMs);
}

async function pedirCredenciales() {
  if (config.db.password && config.db.password.trim() !== '') return true;
  if (!process.stdin.isTTY) {
    console.error(
      '[Seguridad] No hay DB_PASSWORD en .env y no hay terminal interactivo.'
    );
    return false;
  }
  try {
    config.db.password = await promptPassword(
      `Password SQL (${config.db.user}@${config.db.server}): `
    );
    return true;
  } catch (err) {
    console.error('[Seguridad] No se pudo leer la contrasena:', err.message);
    return false;
  }
}

async function main() {
  const ok = await pedirCredenciales();
  if (!ok) process.exit(1);
  createClient({ onReady: startPolling });
}

main();

process.on('SIGINT', async () => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('\n[Workflow] Deteniendo...');
  if (timer) clearInterval(timer);
  await closePool();
  process.exit(0);
});

process.on('SIGTERM', () => process.exit(0));