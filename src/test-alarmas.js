// Smoke test de alarmas. Requiere BD real (si hay DB_PASSWORD en .env).
// Sin credenciales solo comprueba la logica pura (sin conexion).
// Comando:  npm run test-alarmas
import { buildMensaje } from './resumen.js';
import { closePool } from './database.js';

const errores = [];

function esperar(condicion, nombre, extra) {
  if (condicion) {
    console.log(`  OK  ${nombre}`);
  } else {
    errores.push(nombre);
    console.log(`  FALLO  ${nombre}${extra ? ` -> ${extra}` : ''}`);
  }
}

/* ---------- logica pura (sin BD) ---------- */
console.log('== buildMensaje (sin datos) ==');
const dataSin = { total: { Total: 0, Borradas: 0, Suma: 0 }, porEstado: [] };
const desde = new Date(2026, 8, 14, 0, 0, 0, 0);
esperar(buildMensaje(dataSin, desde).includes('Sin movimientos'), 'sin datos -> avisa');

console.log('== buildMensaje (opcion elimInadas) ==');
const dataCol = {
  total: { Total: 3, Borradas: 2, Suma: 1500 },
  porEstado: [{ EstadoDesc: 'Emitida', N: 3, Suma: 1500 }],
};
const conElim = buildMensaje(dataCol, desde);
const sinElim = buildMensaje(dataCol, desde, { elimInadas: false });
esperar(conElim.includes('ELIMINADAS: 2'), 'por defecto incluye eliminadas');
esperar(!sinElim.includes('ELIMINADAS'), 'elimInadas=false oculta eliminadas');
esperar(conElim.includes('TOTAL: 3'), 'incluye total');

/* ---------- integracion (con BD) ---------- */
import { config } from '../config.js';

const tieneBD = Boolean(config.db.password && config.db.password.trim() !== '');

if (!tieneBD) {
  console.log('\n== Sin DB_PASSWORD en .env: se omiten las pruebas de BD ==');
} else {
  console.log('\n== CRUD de alarmas contra la BD ==');
  const {
    crearAlarma,
    actualizarAlarma,
    eliminarAlarma,
    listarAlarmas,
    listarEstados,
  } = await import('./alarmas.js');

  try {
    const [estados, contactos] = await Promise.all([
      listarEstados(),
      (async () => {
        const pool = await (await import('./database.js')).getPool();
        const r = await pool.request().query(
          `SELECT Id FROM dbo.WhatsAppContactos WHERE Activo = 1 ORDER BY Id`
        );
        return r.recordset ?? [];
      })(),
    ]);
    esperar(Array.isArray(estados), 'lista estados REFact');
    console.log(`     (${estados.length} estados en REFact)`);

    if (!contactos.length) {
      console.log('     Sin contactos activos en la BD: se omite el CRUD');
    } else {
      const destinatario = contactos[0].Id;

      const creada = await crearAlarma({
        nombre: '__test_alarma__',
        tipo: 'nueva_factura',
        criterios: { importeMin: 999999, importeMax: null, IDEstado: null },
        hora: '23:00',
        diasSemana: '0123456',
        activo: true,
        contactosIds: [destinatario],
      });
      esperar(creada.ok && creada.Id > 0, 'crear alarma', JSON.stringify(creada));
      const id = creada.Id;

      const lista = await listarAlarmas();
      const enLista = lista.find((a) => a.Id === id);
      esperar(Boolean(enLista), 'aparece en la lista');
      esperar(enLista && enLista.criterios.importeMin === 999999, 'criterios parseados');
      esperar(enLista && enLista.contactos.length === 1, 'destino asociado');

      const act = await actualizarAlarma(id, {
        nombre: '__test_alarma__ v2',
        tipo: 'resumen_dia',
        criterios: { eliminadas: false, avisoSinMovimientos: true },
        hora: '07:30',
        diasSemana: '12345',
        activo: false,
        contactosIds: [destinatario],
      });
      esperar(act.ok, 'actualizar alarma');

      const del = await eliminarAlarma(id);
      esperar(del.ok, 'eliminar alarma');

      const lista2 = await listarAlarmas();
      esperar(!lista2.find((a) => a.Id === id), 'ya no aparece tras borrar');
    }
  } catch (err) {
    errores.push('integración con BD');
    console.error('  FALLO de integración ->', err.message);
  }
}

console.log('\n== Resumen ==');
if (errores.length === 0) {
  console.log(`  Todo OK (${tieneBD ? 'con BD' : 'solo logica pura'}).`);
} else {
  console.log(`  Fallaron ${errores.length}: ${errores.join(', ')}`);
  await closePool().catch(() => {});
  process.exit(1);
}
await closePool().catch(() => {});