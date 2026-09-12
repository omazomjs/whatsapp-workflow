-- ============================================================
-- GESMENSAJERIA - BASE DE DATOS DE MENSAJERIA (WHATSAPP)
-- EJECUTAR COMO SA/ADMIN en: 192.168.1.212\SQL2008
-- Crea la BD, las tablas y el usuario del worker (acceso TOTAL aqui).
-- UNICO valor a cambiar: la clave del login wa_bot.
-- Compatible con SQL Server 2008.
-- ============================================================

-- 1) Base de datos de mensajeria
IF DB_ID('GesMensajeria') IS NULL
    CREATE DATABASE [GesMensajeria];
GO

USE [GesMensajeria];
GO

-- 2) COLA DE MENSAJES: aqui el worker gestiona los mensajes
IF OBJECT_ID('dbo.WhatsAppOutbox', 'U') IS NOT NULL
    DROP TABLE dbo.WhatsAppOutbox;
GO

CREATE TABLE dbo.WhatsAppOutbox (
    Id          INT IDENTITY(1,1) PRIMARY KEY,
    Phone       NVARCHAR(20)   NOT NULL,      -- numero co codigo pais, sin '+'. Ej: 34612345678
    Message     NVARCHAR(MAX)  NOT NULL,
    Status      NVARCHAR(20)   NOT NULL DEFAULT 'PENDING',  -- PENDING | SENDING | SENT | FAILED
    RetryCount  INT            NOT NULL DEFAULT 0,          -- intentos fallidos acumulados
    CreatedAt   DATETIME2      NOT NULL DEFAULT SYSDATETIME(),
    ProcessedAt DATETIME2      NULL,
    Error       NVARCHAR(MAX)  NULL
);
GO

CREATE INDEX IX_WhatsAppOutbox_Status ON dbo.WhatsAppOutbox (Status);
GO

-- 2b) MIGRACION (BD ya existente): anade RetryCount si la tabla ya se creo sin el.
-- Idempotente: no hace nada si la columna ya existe. Ejecutar como sa una vez.
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
               WHERE TABLE_SCHEMA = N'dbo' AND TABLE_NAME = N'WhatsAppOutbox'
                 AND COLUMN_NAME = N'RetryCount')
    ALTER TABLE dbo.WhatsAppOutbox
        ADD RetryCount INT NOT NULL
            CONSTRAINT DF_WhatsAppOutbox_RetryCount DEFAULT 0;
GO

-- 2c) CONTACTOS / DESTINATARIOS DE WHATSAPP (gestionados desde el panel web).
-- Idempotente: solo se crea si no existe (no destruye datos).
IF OBJECT_ID('dbo.WhatsAppContactos', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.WhatsAppContactos (
        Id            INT IDENTITY(1,1) PRIMARY KEY,
        Nombre        NVARCHAR(100)  NOT NULL,
        Telefono      NVARCHAR(20)   NOT NULL UNIQUE,   -- formato intl sin '+'. Ej: 34660400537
        EsResumen     BIT            NOT NULL DEFAULT 0, -- destinatario del resumen diario
        Notas         NVARCHAR(500)  NULL,
        Activo        BIT            NOT NULL DEFAULT 1,
        CreadoAt      DATETIME2      NOT NULL DEFAULT SYSDATETIME(),
        ActualizadoAt DATETIME2      NOT NULL DEFAULT SYSDATETIME()
    );
END
GO

-- 3) ESTADO DEL WORKER: desde que registro (Id) lee cada fuente de datos
IF OBJECT_ID('dbo.WhatsAppState', 'U') IS NOT NULL
    DROP TABLE dbo.WhatsAppState;
GO

CREATE TABLE dbo.WhatsAppState (
    KeyName   NVARCHAR(100) PRIMARY KEY,
    Value     NVARCHAR(200) NOT NULL,
    UpdatedAt DATETIME2     NOT NULL DEFAULT SYSDATETIME()
);
GO

-- 4) Usuario del worker con ACCESO TOTAL a GesMensajeria
-- IMPORTANTE: la clave NO va escrita en este fichero (politica del proyecto).
-- Usa el script "crear_wa_bot.ps1" (te la pide enmascarada y la aplica al momento),
-- o creala a mano en SSMS con sa:
--     CREATE LOGIN [wa_bot] WITH PASSWORD = N'TuClaveCompleja', CHECK_POLICY = ON;
-- El bloque de abajo da permisos SOLO a GesMensajeria (db_owner) y lectura a REFact.

IF EXISTS (SELECT 1 FROM sys.database_principals WHERE name = N'wa_bot')
    DROP USER [wa_bot];
GO
IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name = N'wa_bot')
    THROW 50001, 'El login wa_bot no existe. Crealo antes con crear_wa_bot.ps1 o SSMS. Abortando.', 1;
GO
CREATE USER [wa_bot] FOR LOGIN [wa_bot];
GO

-- Acceso total (puede gestionar colas, estado, etc.)
EXEC sp_addrolemember N'db_owner', N'wa_bot';
GO