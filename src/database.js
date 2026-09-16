import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
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

const CONFIG_TABLE = 'WhatsAppConfig';

export async function getConfig(key, def = null) {
  const pool = await getPool();
  const r = await pool
    .request()
    .input('k', sql.NVarChar, key)
    .query(`SELECT [Value] FROM dbo.${CONFIG_TABLE} WHERE [Key] = @k`);
  return r.recordset.length ? r.recordset[0].Value : def;
}

export async function setConfig(key, value) {
  const pool = await getPool();
  console.log(`[Config] ${key} = ${String(value)}`);
  return pool
    .request()
    .input('k', sql.NVarChar, key)
    .input('v', sql.NVarChar, String(value))
    .query(
       `IF EXISTS (SELECT 1 FROM dbo.${CONFIG_TABLE} WHERE [Key] = @k)
          UPDATE dbo.${CONFIG_TABLE} SET [Value] = @v WHERE [Key] = @k
        ELSE
          INSERT INTO dbo.${CONFIG_TABLE} ([Key], [Value]) VALUES (@k, @v)`
    );
}

/* ------------------------------------------------------------------ *
 *  Usuarios del panel (login multi-usuario).
 *  La contraseña nunca viaja en texto plano: se guarda como
 *  scrypt(sal-16-bytes).Clave = "salHex$hashHex" y se comprueba con
 *  timingSafeEqual. Sin sal nunca se guarda ni se transmite la clave.
 * ------------------------------------------------------------------ */

const USUARIOS_TABLE = 'WhatsAppUsuarios';

export function hashClave(clave) {
  const sal = randomBytes(16).toString('hex');
  const hash = scryptSync(clave, sal, 64).toString('hex');
  return `${sal}$${hash}`;
}

export function verificarClave(clave, almacenada) {
  const [sal, hashEsperado] = String(almacenada).split('$');
  if (!sal || !hashEsperado) return false;
  const calculado = scryptSync(clave, sal, 64);
  const esperado = Buffer.from(hashEsperado, 'hex');
  return calculado.length === esperado.length && timingSafeEqual(calculado, esperado);
}

export async function listarUsuarios() {
  const pool = await getPool();
  const r = await pool
    .request()
    .query(
      `SELECT Id, Usuario, Nombre,
              CASE WHEN EsAdmin = 1 THEN 1 ELSE 0 END AS EsAdmin,
              CASE WHEN Activo  = 1 THEN 1 ELSE 0 END AS Activo,
              CreadoAt
         FROM dbo.${USUARIOS_TABLE}
        ORDER BY EsAdmin DESC, Usuario`
    );
  return r.recordset ?? [];
}

export async function buscarUsuarioPorNombre(usuario) {
  const pool = await getPool();
  const r = await pool
    .request()
    .input('u', sql.NVarChar, usuario)
    .query(
      `SELECT Id, Usuario, ClaveHash, Nombre,
              CASE WHEN EsAdmin = 1 THEN 1 ELSE 0 END AS EsAdmin,
              CASE WHEN Activo  = 1 THEN 1 ELSE 0 END AS Activo
         FROM dbo.${USUARIOS_TABLE}
        WHERE Activo = 1 AND Usuario = @u`
    );
  return r.recordset.length ? r.recordset[0] : null;
}

export async function existeUsuario(usuario) {
  const pool = await getPool();
  const r = await pool
    .request()
    .input('u', sql.NVarChar, usuario)
    .query(`SELECT 1 AS Uno FROM dbo.${USUARIOS_TABLE} WHERE Usuario = @u`);
  return r.recordset.length > 0;
}

export async function crearUsuario({ usuario, clave, nombre, esAdmin = false, activo = true }) {
  const pool = await getPool();
  const claveHash = hashClave(clave);
  const r = await pool
    .request()
    .input('u', sql.NVarChar, usuario)
    .input('h', sql.NVarChar, claveHash)
    .input('n', sql.NVarChar, nombre ?? usuario)
    .input('a', sql.Bit, esAdmin ? 1 : 0)
    .input('t', sql.Bit, activo ? 1 : 0)
    .query(
      `INSERT INTO dbo.${USUARIOS_TABLE} (Usuario, ClaveHash, Nombre, EsAdmin, Activo)
       OUTPUT INSERTED.Id
       VALUES (@u, @h, @n, @a, @t)`
    );
  return r.recordset[0]?.Id;
}

export async function actualizarUsuario(
  id,
  { nombre, esAdmin, activo, clave = null } = {}
) {
  const pool = await getPool();
  const req = pool
    .request()
    .input('i', sql.Int, id)
    .input('n', sql.NVarChar, nombre)
    .input('a', sql.Bit, esAdmin ? 1 : 0)
    .input('t', sql.Bit, activo ? 1 : 0);
  if (clave) req.input('h', sql.NVarChar, hashClave(clave));
  return req.query(
    `UPDATE dbo.${USUARIOS_TABLE} SET
        Nombre = @n, EsAdmin = @a, Activo = @t,
        ActualizadoAt = SYSDATETIME()
        ${clave ? `, ClaveHash = @h` : ''}
      WHERE Id = @i`
  );
}

export async function eliminarUsuario(id) {
  const pool = await getPool();
  return pool
    .request()
    .input('i', sql.Int, id)
    .query(
      `UPDATE dbo.${USUARIOS_TABLE}
          SET Activo = 0, ActualizadoAt = SYSDATETIME()
        WHERE Id = @i`
    );
}

export async function buscarUsuarioPorId(id) {
  const pool = await getPool();
  const r = await pool
    .request()
    .input('i', sql.Int, id)
    .query(
      `SELECT Id, Usuario, Nombre,
              CASE WHEN EsAdmin = 1 THEN 1 ELSE 0 END AS EsAdmin
         FROM dbo.${USUARIOS_TABLE}
        WHERE Id = @i`
    );
  return r.recordset.length ? r.recordset[0] : null;
}

// Borrado definitivo (sin vuelta atras). Solo administradores.
export async function borrarUsuarioDefinitivo(id) {
  const pool = await getPool();
  return pool
    .request()
    .input('i', sql.Int, id)
    .query(`DELETE FROM dbo.${USUARIOS_TABLE} WHERE Id = @i`);
}