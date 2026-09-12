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
    Status      NVARCHAR(20)   NOT NULL DEFAULT 'PENDING',  -- PENDING | SENT | FAILED
    CreatedAt   DATETIME2      NOT NULL DEFAULT SYSDATETIME(),
    ProcessedAt DATETIME2      NULL,
    Error       NVARCHAR(MAX)  NULL
);
GO

CREATE INDEX IX_WhatsAppOutbox_Status ON dbo.WhatsAppOutbox (Status);
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
IF EXISTS (SELECT 1 FROM sys.server_principals WHERE name = N'wa_bot')
    DROP LOGIN [wa_bot];
GO
CREATE LOGIN [wa_bot] WITH PASSWORD = N'CambiaEstaClave_123', CHECK_POLICY = ON;
GO

IF EXISTS (SELECT 1 FROM sys.database_principals WHERE name = N'wa_bot')
    DROP USER [wa_bot];
GO
CREATE USER [wa_bot] FOR LOGIN [wa_bot];
GO

-- Acceso total (puede gestionar colas, estado, etc.)
EXEC sp_addrolemember N'db_owner', N'wa_bot';
GO