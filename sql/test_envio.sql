-- Inserta un mensaje de prueba en la cola de GesMensajeria.
-- El worker lo recoge en < 30s y lo envia al movil configurado.
INSERT INTO GesMensajeria.dbo.WhatsAppOutbox (Phone, Message)
VALUES (
    N'34660400537',
    N'PRUEBA GESMENSAJERIA - ' + CONVERT(nvarchar(30), SYSDATETIME(), 120)
);