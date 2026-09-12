import { config } from '../config.js';
import { promptPassword } from './prompt.js';
import {
  getPool,
  closePool,
  fetchResumenDiario,
  insertOutbox,
} from './database.js';
import { buildMensaje } from './resumen.js';

function toYMD(date) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

function parseFecha(arg) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(arg ?? '');
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0, 0);
}

function fechaDesdeArgs() {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--fecha' && args[i + 1]) return args[i + 1];
  }
  return null;
}

async function main() {
  if (!config.db.password || config.db.password.trim() === '') {
    if (!process.stdin.isTTY) {
      console.error('DB_PASSWORD vacia y sin terminal interactivo.');
      process.exit(1);
    }
    config.db.password = await promptPassword(
      `Password SQL (${config.db.user}@${config.db.server}): `
    );
  }

  await getPool();

  let desde;
  const arg = fechaDesdeArgs();
  if (arg !== null) {
    desde = parseFecha(arg);
    if (!desde) {
      console.error(`Fecha invalida: '${arg}'. Usa el formato YYYY-MM-DD (ej. 2026-09-11).`);
      await closePool();
      process.exit(1);
    }
  } else {
    desde = new Date();
    desde.setHours(0, 0, 0, 0);
  }
  const hasta = new Date(desde);
  hasta.setDate(hasta.getDate() + 1);

  const data = await fetchResumenDiario(desde, hasta);
  const msg = buildMensaje(data, desde);

  console.log('\n===== MENSAJE GENERADO (' + toYMD(desde) + ') =====\n');
  console.log(msg);
  console.log('\n=====================================================\n');

  const recipients = config.resumen.recipients;
  if (!recipients.length) {
    console.error('RESUMEN_RECIPIENTS vacio en .env');
  } else {
    for (const tlf of recipients) {
      await insertOutbox(tlf, msg);
    }
    console.log(
      `Encolado el resumen para ${recipients.length} movil(es). El worker lo envia en <30s.`
    );
  }

  await closePool();
}

main().catch(async (err) => {
  console.error('Error:', err.message);
  await closePool().catch(() => {});
  process.exit(1);
});