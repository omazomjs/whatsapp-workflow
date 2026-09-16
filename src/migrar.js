// Aplica las migraciones pendientes de GesMensajeria usando las credenciales
// normales del worker (wa_bot = db_owner SOLO de GesMensajeria). No usa sa.
// Comandos:  npm run migrar   (idempotente, puede repetirse sin riesgo)
import { getPool, closePool } from './database.js';
import { promptPassword } from './prompt.js';
import { config } from '../config.js';

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

  // ---- Fase 1 de alarmas ----
  // Tabla con las reglas (tipo, criterios JSON, hora y dias de la semana).
  `IF OBJECT_ID('dbo.WhatsAppAlarmas', 'U') IS NULL
   BEGIN
       CREATE TABLE dbo.WhatsAppAlarmas (
           Id            INT IDENTITY(1,1) PRIMARY KEY,
           Nombre        NVARCHAR(120)   NOT NULL,
           Tipo          NVARCHAR(40)    NOT NULL,
           Criterios     NVARCHAR(MAX)   NOT NULL DEFAULT N'{}',
           Hora          TIME(0)         NOT NULL,
           DiasSemana    NVARCHAR(20)    NOT NULL DEFAULT N'0123456',
           Activo        BIT             NOT NULL DEFAULT 1,
           CreadoAt      DATETIME2       NOT NULL DEFAULT SYSDATETIME(),
           ActualizadoAt DATETIME2       NOT NULL DEFAULT SYSDATETIME()
       );
   END;`,

  // Destinatarios de cada alarma (multiseleccion desde WhatsAppContactos).
  `IF OBJECT_ID('dbo.WhatsAppAlarmaContactos', 'U') IS NULL
   BEGIN
       CREATE TABLE dbo.WhatsAppAlarmaContactos (
           AlarmaId   INT NOT NULL,
           ContactoId INT NOT NULL,
           CONSTRAINT PK_WhatsAppAlarmaContactos PRIMARY KEY (AlarmaId, ContactoId),
           CONSTRAINT FK_AlarmaContactos_Alarma
               FOREIGN KEY (AlarmaId) REFERENCES dbo.WhatsAppAlarmas (Id)
               ON DELETE CASCADE,
           CONSTRAINT FK_AlarmaContactos_Contacto
               FOREIGN KEY (ContactoId) REFERENCES dbo.WhatsAppContactos (Id)
       );
   END;`,

  // Historico de ejecuciones (evita repetir y sirve de log del panel).
  `IF OBJECT_ID('dbo.WhatsAppAlarmaEjecuciones', 'U') IS NULL
   BEGIN
       CREATE TABLE dbo.WhatsAppAlarmaEjecuciones (
           Id              INT IDENTITY(1,1) PRIMARY KEY,
           AlarmaId        INT NOT NULL,
           Origen          NVARCHAR(10)   NOT NULL DEFAULT N'AUTO',
           DiaProgramado   DATE           NOT NULL,
           EjecutadaAt     DATETIME2      NOT NULL DEFAULT SYSDATETIME(),
           Resultado       NVARCHAR(20)   NOT NULL,
           Encolados       INT            NOT NULL DEFAULT 0,
           Detalle         NVARCHAR(2000) NULL,
           CONSTRAINT FK_AlarmaEjecuciones_Alarma
               FOREIGN KEY (AlarmaId) REFERENCES dbo.WhatsAppAlarmas (Id)
               ON DELETE CASCADE
       );
       CREATE INDEX IX_AlarmaEjecuciones_Alarma
           ON dbo.WhatsAppAlarmaEjecuciones (AlarmaId, Id DESC);
   END;`,

  // Parametros editables desde el panel (ej: config del resumen diario).
  `IF OBJECT_ID('dbo.WhatsAppConfig', 'U') IS NULL
   BEGIN
CREATE TABLE dbo.WhatsAppConfig (
            [Key] NVARCHAR(100) PRIMARY KEY,
            [Value] NVARCHAR(500) NOT NULL,
           CreadoAt      DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
           ActualizadoAt DATETIME2 NOT NULL DEFAULT SYSDATETIME()
       );
   END;`,

  // Modo de ejecucion de la alarma (DIARIA=resumen a una hora / INMEDIATA=aviso
  // al detectar movimientos nuevos que cumplen el criterio) y marca de agua
  // "UltimoUptoAt" (solo avisar de lo aparecido desde la ultima revision).
  `IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
                   WHERE TABLE_NAME = N'WhatsAppAlarmas' AND COLUMN_NAME = N'Modo')
   BEGIN
       ALTER TABLE dbo.WhatsAppAlarmas ADD Modo NVARCHAR(20) NOT NULL DEFAULT N'DIARIA';
   END;`,
  `IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
                   WHERE TABLE_NAME = N'WhatsAppAlarmas' AND COLUMN_NAME = N'UltimoUptoAt')
   BEGIN
       ALTER TABLE dbo.WhatsAppAlarmas ADD UltimoUptoAt DATETIME2 NULL;
   END;`,

  // Usuarios del panel: cada persona de la empresa puede tener su propio
  // usuario y contraseña. La clave se guarda como hash scrypt (sal:hash), nunca
  // en texto plano. EsAdmin marca quién puede gestionar usuarios.
  `IF OBJECT_ID('dbo.WhatsAppUsuarios', 'U') IS NULL
   BEGIN
       CREATE TABLE dbo.WhatsAppUsuarios (
           Id            INT IDENTITY(1,1) PRIMARY KEY,
           Usuario       NVARCHAR(60)  NOT NULL,
           ClaveHash     NVARCHAR(250) NOT NULL,
           Nombre        NVARCHAR(120) NULL,
           EsAdmin       BIT           NOT NULL DEFAULT 0,
           Activo        BIT           NOT NULL DEFAULT 1,
           CreadoAt      DATETIME2     NOT NULL DEFAULT SYSDATETIME(),
           ActualizadoAt DATETIME2     NOT NULL DEFAULT SYSDATETIME()
       );
       CREATE UNIQUE INDEX IX_WhatsAppUsuarios_Usuario
           ON dbo.WhatsAppUsuarios (Usuario);
   END;`,
];

async function pedirPassword() {
  if (config.db.password && config.db.password.trim() !== '') return true;
  if (!process.stdin.isTTY) {
    console.error('[Migrar] No hay DB_PASSWORD en .env y no hay terminal interactivo.');
    return false;
  }
  try {
    config.db.password = await promptPassword(`Password SQL (${config.db.user}@${config.db.server}): `);
    return true;
  } catch (err) {
    console.error('[Migrar] No se pudo leer la contrasena:', err.message);
    return false;
  }
}

async function main() {
  if (!(await pedirPassword())) process.exit(1);
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