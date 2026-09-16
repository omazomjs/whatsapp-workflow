// Motor de alarmas: reglas "criterio -> mensaje WhatsApp" configuradas en
// el panel. Tipos:
//   - nueva_factura : avisa de facturas dadas de alta hoy que cumplen filtros
//                     (importe minimo/maximo, ID de estado). Puede ejecutarse
//                     en modo DIARIA (resumen a una hora) o INMEDIATA (aviso
//                     en cuanto aparezca algo nuevo, con frenos anti-baneo).
//   - pendientes    : facturas que llevan >= N dias en el sistema (o en un
//                     estado) con importe >= X: aviso diario a una hora.
//   - resumen_dia   : el resumen diario enviado a una hora configurable con
//                     destinatarios elegidos desde WhatsAppContactos.
// El worker revisa cada ALARMAS_INTERVAL_S y ejecuta las que tocan; cada
// ejecucion queda registrada en WhatsAppAlarmaEjecuciones (sin duplicar).
import sql from 'mssql';
import { getPool, insertOutbox } from './database.js';
import { fetchResumenDiario } from './database.js';
import { buildMensaje } from './resumen.js';
import { config } from '../config.js';

const TIPOS_VALIDOS = ['nueva_factura', 'pendientes', 'resumen_dia'];
const MODOS_VALIDOS = ['DIARIA', 'INMEDIATA'];
const DIAS_VALIDOS = '0123456'; // mismo orden que Date.getDay(): 0=Domingo

let ultimaRevisionMs = 0;

/* ---------- frenos anti-baneo del modo INMEDIATA (compartidos) ---------- */
let ultimoEnvioMs = 0;
let bucketHora = '';
let enviosEnHora = 0;
let bucketDia = '';
let enviosEnDia = 0;

function marcarEnvioInmediato() {
  ultimoEnvioMs = Date.now();
  bucketHora = toYMD(new Date()) + ':' + String(new Date().getHours()).padStart(2, '0');
  bucketDia = toYMD(new Date());
  enviosEnHora += 1;
  enviosEnDia += 1;
}

function permitirEnvioInmediato() {
  const ahora = new Date();
  const hb = toYMD(ahora) + ':' + String(ahora.getHours()).padStart(2, '0');
  const db = toYMD(ahora);
  if (hb !== bucketHora) { bucketHora = hb; enviosEnHora = 0; }
  if (db !== bucketDia) { bucketDia = db; enviosEnDia = 0; }
  const min = config.alarmas.minEspacioS;
  if (Date.now() - ultimoEnvioMs < min * 1000)
    return { ok: false, motivo: `minimo ${Math.round(min / 60)} min entre avisos` };
  if (enviosEnHora >= config.alarmas.maxPorHora)
    return { ok: false, motivo: `tope de ${config.alarmas.maxPorHora}/hora alcanzado` };
  if (enviosEnDia >= config.alarmas.maxPorDia)
    return { ok: false, motivo: `tope de ${config.alarmas.maxPorDia}/dia alcanzado` };
  return { ok: true, motivo: '' };
}

/* ---------- utilidades ---------- */

function toYMD(date) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

function inicioDeHoy() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function parseHora(hhmm) {
  const m = /^(\d{2}):(\d{2})/.exec(String(hhmm ?? ''));
  if (!m) return null;
  return { h: Number(m[1]), min: Number(m[2]) };
}

function leerCriterios(raw) {
  try {
    return JSON.parse(raw ?? '{}') || {};
  } catch {
    return {};
  }
}

function fmtEuro(v) {
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(Number(v) || 0);
}

function fechaCorta(date) {
  return date.toLocaleDateString('es-ES');
}

function fmtHoraMin(date) {
  const p = (n) => String(n).padStart(2, '0');
  return `${p(date.getHours())}:${p(date.getMinutes())}`;
}

function operadorSeguro(valor, predeterminado = '>=') {
  const op = String(valor ?? predeterminado);
  return ['>', '<', '=', '>=', '<='].includes(op) ? op : predeterminado;
}

async function estadoDescripcion(pool, idEstado) {
  if (idEstado == null) return null;
  const er = await pool
    .request()
    .input('IDEstado', sql.Int, idEstado)
    .query(`SELECT DescEstado AS Texto FROM [REFact].dbo.Estado WHERE IDEstado = @IDEstado`);
  return er.recordset[0]?.Texto ?? `#${idEstado}`;
}

/* ---------- evaluadores ---------- */

async function evaluarNuevaFactura(criterios) {
  const desde = inicioDeHoy();
  const hasta = new Date(desde);
  hasta.setDate(hasta.getDate() + 1);

  const pool = await getPool();
  const r = await pool
    .request()
    .input('Desde', sql.DateTime, desde)
    .input('Hasta', sql.DateTime, hasta)
    .input('ImporteMin', sql.Float, criterios.importeMin ?? null)
    .input('ImporteMax', sql.Float, criterios.importeMax ?? null)
    .input('IDEstado', sql.Int, criterios.IDEstado ?? null)
    .query(
      `SELECT COUNT(*) AS N, ISNULL(SUM(Importe), 0) AS Suma
         FROM [REFact].dbo.Registro
        WHERE AudiFecha >= @Desde AND AudiFecha < @Hasta
          AND Borrado = 0
          AND (@ImporteMin IS NULL OR Importe >= @ImporteMin)
          AND (@ImporteMax IS NULL OR Importe <= @ImporteMax)
          AND (@IDEstado IS NULL OR Estado = @IDEstado)`
    );

  const fila = r.recordset[0];
  const n = Number(fila?.N) || 0;
  if (n === 0) return { enviar: false };

  const estadoDesc = await estadoDescripcion(pool, criterios.IDEstado);

  const filtros = [];
  if (criterios.importeMin != null) filtros.push(`importe >= ${fmtEuro(criterios.importeMin)}`);
  if (criterios.importeMax != null) filtros.push(`importe <= ${fmtEuro(criterios.importeMax)}`);
  if (estadoDesc) filtros.push(`estado ${estadoDesc}`);

  const lineas = [`NUEVAS FACTURAS EN REFACT DIA ${fechaCorta(desde)}`];
  if (filtros.length) {
    lineas.push('');
    lineas.push(`Criterio: ${filtros.join(', ')}`);
  }
  lineas.push('');
  lineas.push(`NUEVAS: ${n} - ${fmtEuro(fila.Suma)}`);

  return { enviar: true, mensaje: lineas.join('\n') };
}

async function evaluarPendientes(criterios) {
  const importeValor = criterios.importeValor ?? criterios.importeMin ?? null;
  const diasValor = criterios.diasValor ?? criterios.diasMin ?? null;
  const importeOp = operadorSeguro(criterios.importeOp);
  const diasOp = operadorSeguro(criterios.diasOp);
  const pool = await getPool();
  const r = await pool
    .request()
    .input('IDEstado', sql.Int, criterios.IDEstado ?? null)
    .input('ImporteValor', sql.Float, importeValor)
    .input('DiasValor', sql.Int, diasValor)
    .query(
      `SELECT COUNT(*) AS N, ISNULL(SUM(Importe), 0) AS Suma,
              MAX(ISNULL([Dias], 0)) AS DiasMax
         FROM [REFact].dbo.Registro
        WHERE Borrado = 0
          AND (@IDEstado IS NULL OR Estado = @IDEstado)
          AND (@ImporteValor IS NULL OR Importe ${importeOp} @ImporteValor)
          AND (@DiasValor IS NULL OR [Dias] ${diasOp} @DiasValor)`
    );

  const fila = r.recordset[0];
  const n = Number(fila?.N) || 0;
  if (n === 0) return { enviar: false };

  const estadoDesc = await estadoDescripcion(pool, criterios.IDEstado);

  const filtros = [];
  if (estadoDesc) filtros.push(`estado ${estadoDesc}`);
  if (importeValor != null) filtros.push(`importe ${importeOp} ${fmtEuro(importeValor)}`);
  if (diasValor != null) filtros.push(`dias en estado ${diasOp} ${Number(diasValor)}`);

  const lineas = [`FACTURAS ESTANCADAS - ${fechaCorta(new Date())}`];
  if (filtros.length) {
    lineas.push('');
    lineas.push(`Criterio: ${filtros.join(', ')}`);
  }
  lineas.push('');
  lineas.push(`ENCONTRADAS: ${n} - ${fmtEuro(fila.Suma)}`);
  if (fila.DiasMax != null) lineas.push(`Mayor permanencia: ${Number(fila.DiasMax)} dias`);

  return { enviar: true, mensaje: lineas.join('\n') };
}

async function evaluarResumenDia(criterios) {
  const desde = inicioDeHoy();
  const hasta = new Date(desde);
  hasta.setDate(hasta.getDate() + 1);

  const data = await fetchResumenDiario(desde, hasta);
  const total = Number(data.total?.Total) || 0;
  const borradas = Number(data.total?.Borradas) || 0;
  const sinMovimientos = total === 0 && borradas === 0;

  if (sinMovimientos && !criterios.avisoSinMovimientos) return { enviar: false };

  const mensaje = buildMensaje(data, desde, {
    elimInadas: criterios.eliminadas !== false,
  });
  return { enviar: true, mensaje };
}

/* ---------- registro de ejecuciones ---------- */

async function registrar(alarmaId, origen, dia, resultado, encolados, detalle) {
  const pool = await getPool();
  await pool
    .request()
    .input('AlarmaId', sql.Int, alarmaId)
    .input('Origen', sql.NVarChar(10), origen)
    .input('Dia', sql.NVarChar(10), dia)
    .input('Resultado', sql.NVarChar(20), resultado)
    .input('Encolados', sql.Int, encolados)
    .input('Detalle', sql.NVarChar(2000), String(detalle ?? '').slice(0, 2000))
    .query(
      `INSERT INTO dbo.WhatsAppAlarmaEjecuciones
              (AlarmaId, Origen, DiaProgramado, Resultado, Encolados, Detalle)
       VALUES (@AlarmaId, @Origen, @Dia, @Resultado, @Encolados, @Detalle)`
    );

  const keep = Math.max(10, config.alarmas.keepEjecuciones);
  await pool
    .request()
    .input('AlarmaId', sql.Int, alarmaId)
    .input('Keep', sql.Int, keep)
    .query(
      `DELETE FROM dbo.WhatsAppAlarmaEjecuciones
        WHERE AlarmaId = @AlarmaId
          AND Id NOT IN (
            SELECT TOP (@Keep) Id FROM dbo.WhatsAppAlarmaEjecuciones
             WHERE AlarmaId = @AlarmaId ORDER BY Id DESC
          )`
    );
}

/* ---------- ejecucion de una alarma ---------- */

async function ejecutarAlarma(alarma, dia, origen) {
  const criterios = leerCriterios(alarma.Criterios);
  const destinos = (alarma.Telefonos ?? []).filter(Boolean);

  if (!destinos.length) {
    await registrar(alarma.Id, origen, dia, 'ERROR', 0, 'sin destinatarios activos');
    console.log(`[Alarmas] ${alarma.Nombre}: ERROR (sin destinatarios)`);
    return { resultado: 'ERROR', encolados: 0, detalle: 'sin destinatarios activos', mensaje: null, destinatarios: [] };
  }

  try {
    let resultado;
    if (alarma.Tipo === 'nueva_factura') {
      resultado = await evaluarNuevaFactura(criterios);
    } else if (alarma.Tipo === 'pendientes') {
      resultado = await evaluarPendientes(criterios);
    } else if (alarma.Tipo === 'resumen_dia') {
      resultado = await evaluarResumenDia(criterios);
    } else {
      await registrar(alarma.Id, origen, dia, 'ERROR', 0, `tipo desconocido: ${alarma.Tipo}`);
      console.log(`[Alarmas] ${alarma.Nombre}: ERROR (tipo desconocido)`);
      return { resultado: 'ERROR', encolados: 0, detalle: 'tipo desconocido', mensaje: null, destinatarios: destinos };
    }

    if (resultado.enviar && resultado.mensaje) {
      let encolados = 0;
      for (const tlf of destinos) {
        await insertOutbox(tlf, resultado.mensaje);
        encolados += 1;
      }
      await registrar(alarma.Id, origen, dia, 'ENCOLADO', encolados, `${encolados} destinatario(s)`);
      console.log(`[Alarmas] ${alarma.Nombre}: ENCOLADO para ${encolados} movil(es)`);
      return { resultado: 'ENCOLADO', encolados, detalle: `${encolados} destinatario(s)`, mensaje: resultado.mensaje, destinatarios: destinos };
    }

    await registrar(alarma.Id, origen, dia, 'SIN_DATOS', 0, 'no hay datos que cumplan el criterio');
    console.log(`[Alarmas] ${alarma.Nombre}: SIN_DATOS`);
    return { resultado: 'SIN_DATOS', encolados: 0, detalle: 'no hay datos que cumplan el criterio', mensaje: null, destinatarios: destinos };
  } catch (err) {
    await registrar(alarma.Id, origen, dia, 'ERROR', 0, `${err.message}`);
    console.log(`[Alarmas] ${alarma.Nombre}: ERROR -> ${err.message}`);
    return { resultado: 'ERROR', encolados: 0, detalle: err.message, mensaje: null, destinatarios: destinos };
  }
}

/* ---------- modo INMEDIATO (alarma "en cuanto pase algo") ---------- */

async function procesarInmediata(alarma) {
  const ahora = new Date();
  const dia = toYMD(ahora);
  const criterios = leerCriterios(alarma.Criterios);
  const destinos = (alarma.Telefonos ?? []).filter(Boolean);
  const upto = alarma.UltimoUptoAt
    ? new Date(alarma.UltimoUptoAt)
    : new Date(ahora.getTime() - 3600 * 1000); // primera vez: ultima hora

  const pool = await getPool();
  const r = await pool
    .request()
    .input('Upto', sql.DateTime, upto)
    .input('Ahora', sql.DateTime, ahora)
    .input('ImporteMin', sql.Float, criterios.importeMin ?? null)
    .input('ImporteMax', sql.Float, criterios.importeMax ?? null)
    .input('IDEstado', sql.Int, criterios.IDEstado ?? null)
    .query(
      `SELECT COUNT(*) AS N, ISNULL(SUM(Importe), 0) AS Suma
         FROM [REFact].dbo.Registro
        WHERE AudiFecha > @Upto AND AudiFecha <= @Ahora
          AND Borrado = 0
          AND (@ImporteMin IS NULL OR Importe >= @ImporteMin)
          AND (@ImporteMax IS NULL OR Importe <= @ImporteMax)
          AND (@IDEstado IS NULL OR Estado = @IDEstado)`
    );
  const fila = r.recordset[0];
  const n = Number(fila?.N) || 0;

  const actualizarUpto = () =>
    pool
      .request()
      .input('Id', sql.Int, alarma.Id)
      .input('Upto', sql.DateTime2, ahora)
      .query('UPDATE dbo.WhatsAppAlarmas SET UltimoUptoAt = @Upto WHERE Id = @Id');

  if (n === 0) {
    await actualizarUpto();
    return { resultado: 'SIN_DATOS', encolados: 0, detalle: 'sin movimientos nuevos' };
  }
  if (!destinos.length) {
    await registrar(alarma.Id, 'AUTO', dia, 'ERROR', 0, 'sin destinatarios activos');
    await actualizarUpto();
    return { resultado: 'ERROR', encolados: 0, detalle: 'sin destinatarios activos' };
  }

  const permitido = permitirEnvioInmediato();
  if (!permitido.ok) {
    // No se avanza la marca de agua: los movimientos quedan a la espera de
    // que haya hueco (espacio minimo / tope de hora o dia), sin forzar la
    // envio completo de golpe, para no arriesgar un baneo de WhatsApp.
    console.log(
      `[Alarmas] ${alarma.Nombre}: INMEDIATA esperando (${permitido.motivo}); ${n} factura(s) en cola de aviso`
    );
    return { resultado: 'THROTTLED', encolados: 0, detalle: permitido.motivo };
  }

  const filtros = [];
  if (criterios.importeMin != null) filtros.push(`importe >= ${fmtEuro(criterios.importeMin)}`);
  if (criterios.importeMax != null) filtros.push(`importe <= ${fmtEuro(criterios.importeMax)}`);
  const estadoDesc = await estadoDescripcion(pool, criterios.IDEstado);
  if (estadoDesc) filtros.push(`estado ${estadoDesc}`);

  const lineas = [`FACTURAS NUEVAS EN REFACT - ${fechaCorta(ahora)}`];
  if (filtros.length) lineas.push('', `Criterio: ${filtros.join(', ')}`);
  lineas.push('', `${n} factura(s) desde las ${fmtHoraMin(upto)} - ${fmtEuro(fila.Suma)}`);
  const mensaje = lineas.join('\n');

  let encolados = 0;
  try {
    for (const tlf of destinos) {
      await insertOutbox(tlf, mensaje);
      encolados += 1;
    }
    marcarEnvioInmediato();
    await actualizarUpto();
    await registrar(alarma.Id, 'AUTO', dia, 'ENCOLADO', encolados, `inmediata (${n} factura(s)), ${encolados} destino(s)`);
    console.log(`[Alarmas] ${alarma.Nombre}: INMEDIATA ENCOLADO (${n} factura(s), ${encolados} movil(es))`);
    return { resultado: 'ENCOLADO', encolados, detalle: `inmediata (${n} factura(s))`, mensaje };
  } catch (err) {
    await registrar(alarma.Id, 'AUTO', dia, 'ERROR', 0, err.message);
    console.log(`[Alarmas] ${alarma.Nombre}: INMEDIATA ERROR -> ${err.message}`);
    return { resultado: 'ERROR', encolados: 0, detalle: err.message };
  }
}

/* ---------- scheduler del worker ---------- */

export async function procesarAlarmas() {
  if (!config.alarmas.enabled) return;
  const ahora = Date.now();
  if (ahora - ultimaRevisionMs < config.alarmas.intervalSec * 1000) return;
  ultimaRevisionMs = ahora;

  const pool = await getPool();
  const r = await pool.request().query(
    `SELECT a.Id, a.Nombre, a.Tipo, a.Criterios,
            CONVERT(varchar(5), a.Hora, 108) AS Hora, a.DiasSemana,
            a.Modo, a.UltimoUptoAt,
            c.Telefono
       FROM dbo.WhatsAppAlarmas a
       LEFT JOIN dbo.WhatsAppAlarmaContactos ac ON ac.AlarmaId = a.Id
       LEFT JOIN dbo.WhatsAppContactos c ON c.Id = ac.ContactoId AND c.Activo = 1
      WHERE a.Activo = 1
      ORDER BY a.Id`
  );

  const porAlarma = new Map();
  for (const fila of r.recordset ?? []) {
    if (!porAlarma.has(fila.Id)) {
      porAlarma.set(fila.Id, {
        Id: fila.Id,
        Nombre: fila.Nombre,
        Tipo: fila.Tipo,
        Criterios: fila.Criterios ?? '{}',
        Hora: fila.Hora,
        DiasSemana: String(fila.DiasSemana ?? '0123456'),
        Modo: String(fila.Modo ?? 'DIARIA').toUpperCase(),
        UltimoUptoAt: fila.UltimoUptoAt,
        Telefonos: [],
      });
    }
    if (fila.Telefono) porAlarma.get(fila.Id).Telefonos.push(fila.Telefono);
  }

  const ahoraFecha = new Date();
  const dia = toYMD(ahoraFecha);
  const diaSemana = String(ahoraFecha.getDay());

  const noDias = '0123456';
  for (const alarma of porAlarma.values()) {
    if (alarma.Modo === 'INMEDIATA') {
      if (alarma.Tipo !== 'nueva_factura') continue;
      await procesarInmediata(alarma);
      continue;
    }

    const hora = parseHora(alarma.Hora);
    if (!hora) continue;

    const objetivo = new Date(ahoraFecha);
    objetivo.setHours(hora.h, hora.min, 0, 0);
    if (ahoraFecha < objetivo) continue;
    if (!String(alarma.DiasSemana ?? noDias).includes(diaSemana)) continue;

    const ya = await pool
      .request()
      .input('AlarmaId', sql.Int, alarma.Id)
      .input('Dia', sql.NVarChar(10), dia)
      .query(
        `SELECT TOP (1) 1 AS Existe FROM dbo.WhatsAppAlarmaEjecuciones
          WHERE AlarmaId = @AlarmaId AND DiaProgramado = @Dia AND Origen = 'AUTO'`
      );
    if (ya.recordset.length) continue;

    await ejecutarAlarma(alarma, dia, 'AUTO');
  }
}

/* ---------- API para el panel ---------- */

export async function listarAlarmas() {
  const pool = await getPool();
  const r = await pool.request().query(
    `SELECT a.Id, a.Nombre, a.Tipo, a.Criterios,
            CONVERT(varchar(5), a.Hora, 108) AS Hora, a.DiasSemana, a.Activo,
            a.Modo, a.UltimoUptoAt,
            c.Id AS ContactoId, c.Nombre AS ContactoNombre
       FROM dbo.WhatsAppAlarmas a
       LEFT JOIN dbo.WhatsAppAlarmaContactos ac ON ac.AlarmaId = a.Id
       LEFT JOIN dbo.WhatsAppContactos c ON c.Id = ac.ContactoId
      ORDER BY a.Activo DESC, a.Id`
  );

  const mapa = new Map();
  for (const fila of r.recordset ?? []) {
    if (!mapa.has(fila.Id)) {
      mapa.set(fila.Id, {
        Id: fila.Id,
        Nombre: fila.Nombre,
        Tipo: fila.Tipo,
        criterios: leerCriterios(fila.Criterios),
        Hora: fila.Hora,
        DiasSemana: String(fila.DiasSemana ?? '0123456'),
        Activo: Boolean(fila.Activo),
        Modo: String(fila.Modo ?? 'DIARIA').toUpperCase(),
        ultimoUptoAt: fila.UltimoUptoAt,
        contactos: [],
      });
    }
    if (fila.ContactoId != null) {
      mapa.get(fila.Id).contactos.push({
        Id: fila.ContactoId,
        Nombre: fila.ContactoNombre,
      });
    }
  }
  return [...mapa.values()];
}

export async function listarEstados() {
  const pool = await getPool();
  const r = await pool.request().query(
    `SELECT IDEstado AS Id, DescEstado AS Texto FROM [REFact].dbo.Estado ORDER BY IDEstado`
  );
  return r.recordset ?? [];
}

export async function crearAlarma(datos) {
  const limpios = validarDatos(datos);
  const pool = await getPool();
  const tx = pool.transaction();
  await tx.begin();
  try {
    const ins = await tx
      .request()
      .input('Nombre', sql.NVarChar(120), limpios.nombre)
      .input('Tipo', sql.NVarChar(40), limpios.tipo)
      .input('Criterios', sql.NVarChar(sql.MAX), JSON.stringify(limpios.criterios))
      .input('Hora', sql.NVarChar(5), limpios.hora)
      .input('Dias', sql.NVarChar(20), limpios.diasSemana)
      .input('Activo', sql.Bit, limpios.activo)
      .input('Modo', sql.NVarChar(20), limpios.modo)
      .query(
        `INSERT INTO dbo.WhatsAppAlarmas (Nombre, Tipo, Criterios, Hora, DiasSemana, Activo, Modo)
         VALUES (@Nombre, @Tipo, @Criterios, @Hora, @Dias, @Activo, @Modo);
         SELECT SCOPE_IDENTITY() AS Id`
      );
    const id = Number(ins.recordset[0].Id);
    await insertarContactos(tx, id, limpios.contactosIds);
    await tx.commit();
    return { ok: true, Id: id };
  } catch (err) {
    await tx.rollback().catch(() => {});
    throw err;
  }
}

export async function actualizarAlarma(id, datos) {
  const limpios = validarDatos(datos);
  const pool = await getPool();
  const tx = pool.transaction();
  await tx.begin();
  try {
    await tx
      .request()
      .input('Id', sql.Int, Number(id))
      .input('Nombre', sql.NVarChar(120), limpios.nombre)
      .input('Tipo', sql.NVarChar(40), limpios.tipo)
      .input('Criterios', sql.NVarChar(sql.MAX), JSON.stringify(limpios.criterios))
      .input('Hora', sql.NVarChar(5), limpios.hora)
      .input('Dias', sql.NVarChar(20), limpios.diasSemana)
      .input('Activo', sql.Bit, limpios.activo)
      .input('Modo', sql.NVarChar(20), limpios.modo)
      .query(
        `UPDATE dbo.WhatsAppAlarmas
            SET Nombre = @Nombre, Tipo = @Tipo, Criterios = @Criterios,
                Hora = @Hora, DiasSemana = @Dias, Activo = @Activo,
                Modo = @Modo,
                ActualizadoAt = SYSDATETIME()
          WHERE Id = @Id`
      );
    await tx.request().input('Id', sql.Int, Number(id)).query(
      `DELETE FROM dbo.WhatsAppAlarmaContactos WHERE AlarmaId = @Id`
    );
    await insertarContactos(tx, Number(id), limpios.contactosIds);
    await tx.commit();
    return { ok: true };
  } catch (err) {
    await tx.rollback().catch(() => {});
    throw err;
  }
}

export async function eliminarAlarma(id) {
  const pool = await getPool();
  await pool
    .request()
    .input('Id', sql.Int, Number(id))
    .query(`DELETE FROM dbo.WhatsAppAlarmas WHERE Id = @Id`);
  return { ok: true };
}

export async function ejecucionesAlarma(id, n = 20) {
  const pool = await getPool();
  const r = await pool
    .request()
    .input('Id', sql.Int, Number(id))
    .input('N', sql.Int, Math.min(Math.max(Number(n) || 20, 1), 100))
    .query(
      `SELECT TOP (@N) Id, Origen, CONVERT(varchar(10), DiaProgramado, 120) AS Dia,
              CONVERT(varchar(19), EjecutadaAt, 120) AS EjecutadaAt,
              Resultado, Encolados, Detalle
         FROM dbo.WhatsAppAlarmaEjecuciones
        WHERE AlarmaId = @Id
        ORDER BY Id DESC`
    );
  return r.recordset ?? [];
}

export async function probarAlarma(id) {
  const pool = await getPool();
  const r = await pool
    .request()
    .input('Id', sql.Int, Number(id))
    .query(
      `SELECT a.Id, a.Nombre, a.Tipo, a.Criterios,
              CONVERT(varchar(5), a.Hora, 108) AS Hora, a.DiasSemana,
              c.Telefono
         FROM dbo.WhatsAppAlarmas a
         LEFT JOIN dbo.WhatsAppAlarmaContactos ac ON ac.AlarmaId = a.Id
         LEFT JOIN dbo.WhatsAppContactos c ON c.Id = ac.ContactoId AND c.Activo = 1
        WHERE a.Id = @Id`
    );
  if (!r.recordset.length) {
    const e = new Error('Alarma no encontrada');
    e.code = 'ENOENT';
    throw e;
  }
  const filas = r.recordset;
  const alarma = {
    Id: filas[0].Id,
    Nombre: filas[0].Nombre,
    Tipo: filas[0].Tipo,
    Criterios: filas[0].Criterios ?? '{}',
    Telefonos: filas.map((f) => f.Telefono).filter(Boolean),
  };
  const dia = toYMD(new Date());
  return ejecutarAlarma(alarma, dia, 'PRUEBA');
}

/* ---------- validacion ---------- */

async function insertarContactos(tx, alarmaId, contactosIds) {
  for (const cid of contactosIds) {
    await tx
      .request()
      .input('AlarmaId', sql.Int, alarmaId)
      .input('ContactoId', sql.Int, cid)
      .query(
        `INSERT INTO dbo.WhatsAppAlarmaContactos (AlarmaId, ContactoId)
         VALUES (@AlarmaId, @ContactoId)`
      );
  }
}

function validarDatos(datos) {
  const nombre = String(datos?.nombre ?? '').trim().slice(0, 120);
  const tipo = String(datos?.tipo ?? '');
  if (!nombre) throw new Error('Nombre obligatorio');
  if (!TIPOS_VALIDOS.includes(tipo)) throw new Error('Tipo de alarma invalido');

  const modo = String(datos?.modo ?? 'DIARIA').toUpperCase();
  if (!MODOS_VALIDOS.includes(modo)) throw new Error('Modo de ejecucion invalido');
  if (modo === 'INMEDIATA' && tipo !== 'nueva_factura')
    throw new Error('El modo INMEDIATA solo aplica a alarmas de nueva factura');

  const hora = String(datos?.hora ?? '').trim();
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(hora)) throw new Error('Hora invalida (HH:MM)');

  const dias = String(datos?.diasSemana ?? '0123456')
    .split('')
    .filter((c) => DIAS_VALIDOS.includes(c))
    .join('');
  if (!dias) throw new Error('Elige al menos un dia de la semana');

  const contactosIds = Array.isArray(datos?.contactosIds)
    ? [...new Set(datos.contactosIds.map((x) => Number(x)))]
        .filter((x) => Number.isInteger(x) && x > 0)
    : [];
  if (!contactosIds.length) throw new Error('Selecciona al menos un destinatario');

  return {
    nombre,
    tipo,
    modo,
    criterios: validarCriterios(tipo, datos?.criterios ?? {}),
    hora,
    diasSemana: dias,
    activo: datos?.activo !== undefined ? Boolean(datos.activo) : true,
    contactosIds,
  };
}

function num(c) {
  return c === null || c === undefined || c === '' ? null : Number(c);
}

function validarCriterios(tipo, c) {
  if (tipo === 'nueva_factura') {
    const importeMin = num(c.importeMin);
    const importeMax = num(c.importeMax);
    const IDEstado = num(c.IDEstado);
    if (importeMin !== null && (!Number.isFinite(importeMin) || importeMin < 0))
      throw new Error('Importe minimo no valido');
    if (importeMax !== null && (!Number.isFinite(importeMax) || importeMax < 0))
      throw new Error('Importe maximo no valido');
    if (importeMin !== null && importeMax !== null && importeMin > importeMax)
      throw new Error('El importe minimo no puede ser mayor que el maximo');
    if (IDEstado !== null && (!Number.isInteger(IDEstado) || IDEstado <= 0))
      throw new Error('Estado no valido');
    return { importeMin, importeMax, IDEstado };
  }
  if (tipo === 'pendientes') {
    const importeValor = num(c.importeValor ?? c.importeMin);
    const diasValor = num(c.diasValor ?? c.diasMin);
    const importeOp = operadorSeguro(c.importeOp);
    const diasOp = operadorSeguro(c.diasOp);
    const IDEstado = num(c.IDEstado);
    if (importeValor !== null && (!Number.isFinite(importeValor) || importeValor < 0))
      throw new Error('Importe no valido');
    if (diasValor !== null && (!Number.isInteger(diasValor) || diasValor < 0))
      throw new Error('Dias en estado no validos (entero, >= 0)');
    if (diasValor === null && importeValor === null)
      throw new Error('Obligatorio indicar dias en estado o importe');
    if (IDEstado !== null && (!Number.isInteger(IDEstado) || IDEstado <= 0))
      throw new Error('Estado no valido');
    return { importeOp, importeValor, diasOp, diasValor, IDEstado };
  }
  if (tipo === 'resumen_dia') {
    return {
      eliminadas: c.eliminadas !== false,
      avisoSinMovimientos: Boolean(c.avisoSinMovimientos),
    };
  }
  return {};
}
