// Aplica las migraciones pendientes de GesMensajeria usando las credenciales
// normales del worker (wa_bot = db_owner SOLO de GesMensajeria). No usa sa.
// Comandos:  npm run migrar   (idempotente, puede repetirse sin riesgo)
import { getPool, closePool } from './database.js';

const MIGRACIONES = [
  `IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
                  WHERE TABLE_SCHEMA = N'dbo' AND TABLE_NAME = N'WhatsAppOutbox'
                    AND COLUMN_NAME = N'RetryCount')
       ALTER TABLE dbo.WhatsAppOutbox
           ADD RetryCount INT NOT NULL
               CONSTRAINT DF_WhatsAppOutbox_RetryCount DEFAULT 0;`,

  `IF OBJECT_ID('dbo.WhatsAppContactos', 'U') IS NULL
   BEGIN
       CREATE TABLE dbo.WhatsAppContactos (
           Id            INT IDENTITY(1,1) PRIMARY KEY,
           Nombre        NVARCHAR(100)  NOT NULL,
           Telefono      NVARCHAR(20)   NOT NULL UNIQUE,
           EsResumen     BIT            NOT NULL DEFAULT 0,
           Notas         NVARCHAR(500)  NULL,
           Activo        BIT            NOT NULL DEFAULT 1,
           CreadoAt      DATETIME2      NOT NULL DEFAULT SYSDATETIME(),
           ActualizadoAt DATETIME2      NOT NULL DEFAULT SYSDATETIME()
       );
   END;`,
];

async function main() {
  const pool = await getPool();
  const total = MIGRACIONES.length;
  let aplicadas = 0;

  for (const [i, sql] of MIGRACIONES.entries()) {
    try {
      await pool.request().query(sql);
      aplicadas += 1;
      console.log(`[Migrar] ${i + 1}/${total}: OK`);
    } catch (err) {
      console.error(`[Migrar] ${i + 1}/${total}: ERROR -> ${err.message}`);
      await closePool().catch(() => {});
      process.exit(1);
    }
  }

  await closePool();
  console.log(`[Migrar] Migracion terminada (${aplicadas}/${total} bloques aplicados).`);
  console.log('[Migrar] Comprueba con el panel: contactos y RetryCount disponibles.');
}

main().catch(async (err) => {
  console.error('[Migrar] Error general:', err.message);
  await closePool().catch(() => {});
  process.exit(1);
});