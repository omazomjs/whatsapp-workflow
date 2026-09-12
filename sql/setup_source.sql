-- ============================================================
-- PERMISO DE SOLO LECTURA PARA EL WORKER
-- EJECUTAR DENTRO de CADA base de datos de negocio de la que
-- quieras LEER datos. Con esto el worker puede LEER las tablas
-- pero JAMAS escribir en ellas. Compatible con SQL Server 2008.
-- ============================================================

USE [REFact];   -- <-- base de datos de negocio (modifica si cambia)
GO

IF EXISTS (SELECT 1 FROM sys.database_principals WHERE name = N'wa_bot')
    DROP USER [wa_bot];
GO
CREATE USER [wa_bot] FOR LOGIN [wa_bot];
GO

-- db_datareader = SOLO lectura de datos
EXEC sp_addrolemember N'db_datareader', N'wa_bot';
GO