-- PREVIEW del resumen del dia (misma logica que el worker a las 23:00).
-- Ejecutar en REFact (con sa). Muestra totales, sumas, borradas y por estado.
SET NOCOUNT ON;

DECLARE @Desde datetime = CAST(CONVERT(varchar(10), GETDATE(), 120) AS datetime);
DECLARE @Hasta datetime = DATEADD(day, 1, @Desde);

PRINT '=== RESUMEN DEL DIA (preview) ===';

SELECT COUNT(*)                    AS TotalFacturas,
       ISNULL(SUM(Importe), 0)     AS SumaImporte,
       SUM(CASE WHEN Borrado = 1 THEN 1 ELSE 0 END) AS Borradas
  FROM [REFact].[dbo].[Registro]
 WHERE AudiFecha >= @Desde AND AudiFecha < @Hasta;

PRINT '';
PRINT '=== POR ESTADO (con numero y suma) ===';
SELECT ISNULL(e.DescEstado, N'sin estado') AS Estado,
       COUNT(*) AS N,
       ISNULL(SUM(r.Importe), 0) AS SumaImporte
  FROM [REFact].[dbo].[Registro] r
  LEFT JOIN [REFact].[dbo].[Estado] e ON r.Estado = e.IDEstado
 WHERE r.AudiFecha >= @Desde AND r.AudiFecha < @Hasta
 GROUP BY e.DescEstado
 ORDER BY e.DescEstado;

PRINT '';
PRINT '=== CATALOGO DE ESTADOS (dbo.Estado) ===';
SELECT IDEstado, DescEstado
  FROM [REFact].[dbo].[Estado]
 ORDER BY IDEstado;