import 'dotenv/config';

export const config = {
  db: {
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    server: process.env.DB_SERVER,
    database: process.env.DB_DATABASE,
    port: Number(process.env.DB_PORT ?? 1433),
    pool: { max: 5, min: 0, idleTimeoutMillis: 30000 },
    options: {
      encrypt: (process.env.DB_ENCRYPT ?? 'false') === 'true',
      trustServerCertificate: (process.env.DB_TRUST_CERT ?? 'true') === 'true',
    },
  },
  polling: {
    intervalMs: Number(process.env.POLL_INTERVAL_MS ?? 30000),
    batchSize: Number(process.env.BATCH_SIZE ?? 5),
    outboxTable: process.env.OUTBOX_TABLE ?? 'WhatsAppOutbox',
    maxRetry: Number(process.env.OUTBOX_MAX_RETRY ?? 3),
    staleMinutes: Number(process.env.OUTBOX_STALE_MINUTES ?? 2),
  },
  source: {
    enabled: (process.env.SRC_ENABLED ?? 'false') === 'true',
    database: process.env.SRC_DATABASE,
    table: process.env.SRC_TABLE,
    idColumn: process.env.SRC_ID_COLUMN ?? 'Id',
    where: process.env.SRC_WHERE ?? '',
    phoneColumn: process.env.SRC_PHONE_COLUMN ?? 'Telefono',
    messageTemplate: process.env.SRC_MESSAGE_TEMPLATE ?? '',
  },
  resumen: {
    enabled: (process.env.RESUMEN_ENABLED ?? 'false') === 'true',
    hour: Number(process.env.RESUMEN_HORA ?? 23),
    minute: Number(process.env.RESUMEN_MINUTO ?? 0),
    recipients: (process.env.RESUMEN_RECIPIENTS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    catchupDays: Number(process.env.RESUMEN_CATCHUP_DAYS ?? 7),
  },
  alarmas: {
    enabled: (process.env.ALARMAS_ENABLED ?? 'true') === 'true',
    intervalSec: Math.max(15, Number(process.env.ALARMAS_INTERVAL_S ?? 60)),
    keepEjecuciones: Number(process.env.ALARMAS_HISTORIAL ?? 200),
  },
  whatsapp: {
    sessionDir: process.env.WA_SESSION_DIR ?? 'sessions',
    chromePath: process.env.WA_CHROME_PATH,
    qrPort: Number(process.env.WA_QR_PORT ?? 0),
  },
  web: {
    port: Number(process.env.WEB_PORT ?? 3000),
    user: process.env.WEB_USER ?? '',
    password: process.env.WEB_PASSWORD ?? '',
    sessionSecret: process.env.WEB_SESSION_SECRET ?? '',
    tlsCert: process.env.WEB_SSL_CERT ?? '',
    tlsKey: process.env.WEB_SSL_KEY ?? '',
    httpsPort: Number(process.env.WEB_HTTPS_PORT ?? 3443),
  },
};

export function safeTableName(name) {
  const clean = String(name ?? '').trim();
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(clean) ? clean : 'WhatsAppOutbox';
}