-- ============================================================
-- EJEMPLO OPCIONAL: un proyecto tambien puede INSERTAR su aviso
-- directamente en la cola sin pasar por el worker.
-- EJECUTAR DENTRO de la base de datos del proyecto (ej: tu BD de
-- pedidos), NO en GesMensajeria.
-- Compatible con SQL Server 2008 (sin CONCAT ni FORMAT, son de 2012+).
-- ============================================================

IF OBJECT_ID('dbo.TR_Pedidos_OnInsert', 'TR') IS NOT NULL
    DROP TRIGGER dbo.TR_Pedidos_OnInsert;
GO

CREATE TRIGGER dbo.TR_Pedidos_OnInsert
ON dbo.Pedidos
AFTER INSERT
AS
BEGIN
    SET NOCOUNT ON;

    INSERT INTO GesMensajeria.dbo.WhatsAppOutbox (Phone, Message)
    SELECT
        i.ClienteTelefono,  -- numero con codigo pais, sin '+'
        N'Nuevo pedido ' + i.Codigo
        + N' de ' + i.Cliente
        + N' por ' + CAST(i.Importe AS NVARCHAR(20))
        + CASE WHEN i.Urgente = 1 THEN N' [URGENTE]' ELSE N'' END
    FROM inserted i
    WHERE i.Importe >= 500          -- <-- tus condiciones
       OR i.Urgente = 1;            -- <-- tus condiciones
END;
GO

-- OJO PERMISOS: el usuario que inserta en tu BD de pedidos necesita
-- permiso de INSERT sobre GesMensajeria.dbo.WhatsAppOutbox. Si el
-- trigger falla por permisos, ejecuta este script como sa (sysadmin).

-- PRUEBA (despues de crear tu tabla Pedidos):
-- INSERT INTO dbo.Pedidos (Codigo, Importe, Urgente, Cliente, ClienteTelefono)
-- VALUES ('PED-001', 750, 0, 'ACME SL', '34612345678');   -- avisa
-- SELECT * FROM GesMensajeria.dbo.WhatsAppOutbox;