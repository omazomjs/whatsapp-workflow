import sql from 'mssql';
import { config, safeTableName } from '../config.js';

let pool;

export async function getPool() {
  if (!pool) {
    pool = await new sql.ConnectionPool(config.db).connect();
  }
  return pool;
}

export async function closePool() {
  if (pool) {
    try {
      await pool.close();
    } finally {
      pool = undefined;
    }
  }
}

export async function fetchPending(batchSize, outboxTable) {
  const table = safeTableName(outboxTable);
  const pool = await getPool();
  const result = await pool
    .request()
    .input('MaxRetry', sql.Int, config.polling.maxRetry)
    .input('StaleMinutes', sql.Int, config.polling.staleMinutes)
    .query(
      `SELECT TOP (${Number(batchSize)}) Id, Phone, Message, RetryCount
         FROM dbo.${table}
        WHERE Status = 'PENDING'
           OR (Status = 'SENDING' AND ProcessedAt <= DATEADD(MINUTE, -@StaleMinutes, SYSDATETIME()))
           OR (Status = 'FAILED' AND RetryCount < @MaxRetry)
        ORDER BY Id ASC`
    );
  return result.recordset ?? [];
}

export async function setSending(id) {
  await runUpdate(id, 'SENDING', null);
}

export async function markSent(id) {
  await runUpdate(id, 'SENT', null);
}

export async function markFailed(id, error) {
  await runUpdate(id, 'FAILED', String(error ?? 'Desconocido').slice(0, 2000));
}

async function runUpdate(id, status, error) {
  const pool = await getPool();
  const request = pool
    .request()
    .input('Id', sql.Int, id)
    .input('Status', sql.NVarChar(20), status)
    .input('Error', sql.NVarChar(sql.MAX), error);
  await request.query(
    `UPDATE dbo.${safeTableName(config.polling.outboxTable)}
        SET Status = @Status,
            Error = @Error,
            ProcessedAt = SYSDATETIME(),
            RetryCount = CASE WHEN @Status = 'FAILED' THEN RetryCount + 1 ELSE RetryCount END
      WHERE Id = @Id`
  );
}

export async function fetchSourceRows(lastId) {
  const { database, table, idColumn, where } = config.source;
  if (!database || !table) return [];

  const tableRef = table.replace(/^\[([^\]]+)\]$/g, '$1');
  const from = tableRef.includes('.') ? tableRef : `dbo.${tableRef}`;
  const whereClause = where ? ` AND (${where})` : '';

  const pool = await getPool();
  const result = await pool
    .request()
    .input('LastId', sql.BigInt, lastId)
    .query(
      `SELECT TOP (100) *
         FROM [${database}].${from}
        WHERE ${idColumn} > @LastId${whereClause}
        ORDER BY ${idColumn} ASC`
    );
  return result.recordset ?? [];
}

export async function insertOutbox(phone, message) {
  const pool = await getPool();
  await pool
    .request()
    .input('Phone', sql.NVarChar(20), String(phone))
    .input('Message', sql.NVarChar(sql.MAX), String(message))
    .query(
      `INSERT INTO dbo.${safeTableName(config.polling.outboxTable)} (Phone, Message)
       VALUES (@Phone, @Message)`
    );
}

export async function getState(key) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('Key', sql.NVarChar(100), key)
    .query(`SELECT Value FROM dbo.WhatsAppState WHERE KeyName = @Key`);
  const value = result.recordset[0]?.Value;
  return value === undefined || value === null ? null : String(value);
}

export async function setState(key, value) {
  const pool = await getPool();
  await pool
    .request()
    .input('Key', sql.NVarChar(100), key)
    .input('Value', sql.NVarChar(200), String(value))
    .query(
      `IF EXISTS (SELECT 1 FROM dbo.WhatsAppState WHERE KeyName = @Key)
           UPDATE dbo.WhatsAppState SET Value = @Value, UpdatedAt = SYSDATETIME() WHERE KeyName = @Key
       ELSE
           INSERT INTO dbo.WhatsAppState (KeyName, Value) VALUES (@Key, @Value)`
    );
}

export async function fetchResumenDiario(desde, hasta) {
  const { database, table } = config.source;
  const tableRef = table.replace(/^\[([^\]]+)\]$/g, '$1');
  const from = tableRef.includes('.') ? tableRef : `dbo.${tableRef}`;
  const dbFrom = `[${database}].${from}`;

  const pool = await getPool();

  const totals = await pool
    .request()
    .input('Desde', sql.DateTime, desde)
    .input('Hasta', sql.DateTime, hasta)
    .query(
      `SELECT COUNT(*) AS Total,
              ISNULL(SUM(Importe), 0) AS Suma,
              SUM(CASE WHEN Borrado = 1 THEN 1 ELSE 0 END) AS Borradas
         FROM ${dbFrom}
        WHERE AudiFecha >= @Desde AND AudiFecha < @Hasta`
    );

  const porEstado = await pool
    .request()
    .input('Desde', sql.DateTime, desde)
    .input('Hasta', sql.DateTime, hasta)
    .query(
      `SELECT ISNULL(e.DescEstado, N'sin estado') AS EstadoDesc,
              COUNT(*) AS N,
              ISNULL(SUM(r.Importe), 0) AS Suma
         FROM ${dbFrom} r
         LEFT JOIN [${database}].dbo.Estado e ON r.Estado = e.IDEstado
        WHERE r.AudiFecha >= @Desde AND r.AudiFecha < @Hasta
        GROUP BY e.DescEstado
        ORDER BY e.DescEstado`
    );

  return { total: totals.recordset[0], porEstado: porEstado.recordset ?? [] };
}