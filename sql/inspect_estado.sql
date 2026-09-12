SET NOCOUNT ON;

PRINT '=== 1) CLAVES FORANEAS DE dbo.Registro (para ver si Estado referencia otra tabla) ===';
SELECT c.name AS Columna,
       OBJECT_SCHEMA_NAME(k.referenced_object_id) + '.' + OBJECT_NAME(k.referenced_object_id) AS TablaReferenciada,
       rc.name AS ColumnaReferenciada
  FROM sys.foreign_keys k
  JOIN sys.foreign_key_columns kc ON k.object_id = kc.constraint_object_id
  JOIN sys.columns c ON kc.parent_object_id = c.object_id AND kc.parent_column_id = c.column_id
  JOIN sys.columns rc ON kc.referenced_object_id = rc.object_id AND kc.referenced_column_id = rc.column_id
 WHERE k.parent_object_id = OBJECT_ID('Registro');

PRINT '';
PRINT '=== 2) TABLAS CON "Estado" EN EL NOMBRE ===';
SELECT TABLE_SCHEMA AS Esquema, TABLE_NAME AS Tabla
  FROM INFORMATION_SCHEMA.TABLES
 WHERE TABLE_NAME LIKE '%Estado%'
 ORDER BY TABLE_NAME;

PRINT '';
PRINT '=== 3) COLUMNAS DE ESAS TABLAS ===';
SELECT TABLE_NAME AS Tabla,
       COLUMN_NAME AS Columna,
       DATA_TYPE + ISNULL('(' + CAST(CHARACTER_MAXIMUM_LENGTH AS VARCHAR(10)) + ')', '') AS Tipo,
       IS_NULLABLE AS Nula
  FROM INFORMATION_SCHEMA.COLUMNS
 WHERE TABLE_NAME LIKE '%Estado%'
 ORDER BY TABLE_NAME, ORDINAL_POSITION;