import sql from 'mssql';
import { getPool, closePool } from './src/database.js';

const usuario = String(process.argv[2] ?? '').trim();
if (!/^[A-Za-z0-9._-]{1,80}$/.test(usuario)) {
  console.error('Uso: node hacer_admin.mjs <usuario>');
  process.exitCode = 1;
} else {
  try {
    const pool = await getPool();
    const resultado = await pool
      .request()
      .input('usuario', sql.NVarChar(80), usuario)
      .query(`
        UPDATE dbo.WhatsAppUsuarios
           SET EsAdmin = 1,
               Activo = 1,
               ActualizadoAt = SYSDATETIME()
         WHERE Usuario = @usuario;
        SELECT @@ROWCOUNT AS Cambiados;
      `);

    const cambiados = Number(resultado.recordset?.[0]?.Cambiados ?? 0);
    if (cambiados !== 1) {
      console.error(`ADMIN_NO_CAMBIADO:${usuario}:filas=${cambiados}`);
      process.exitCode = 2;
    } else {
      console.log(`ADMIN_OK:${usuario}`);
    }
  } catch (error) {
    console.error(`ADMIN_ERROR:${error?.message ?? error}`);
    process.exitCode = 3;
  } finally {
    await closePool().catch(() => {});
  }
}
