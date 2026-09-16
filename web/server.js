import crypto from 'node:crypto';
import fs from 'node:fs';
import https from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import session from 'express-session';
import { config } from '../config.js';
import {
  getPool,
  closePool,
  getConfig,
  setConfig,
  listarUsuarios,
  buscarUsuarioPorNombre,
  existeUsuario,
  crearUsuario,
  actualizarUsuario,
  eliminarUsuario,
  verificarClave,
} from '../src/database.js';
import { normalizeNumber } from '../src/outbox.js';
import {
  listarAlarmas,
  listarEstados,
  crearAlarma,
  actualizarAlarma,
  eliminarAlarma,
  ejecucionesAlarma,
  probarAlarma,
} from '../src/alarmas.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(express.json({ limit: '1mb' }));

const esTls = Boolean(
  config.web.tlsCert &&
    config.web.tlsKey &&
    fs.existsSync(config.web.tlsCert) &&
    fs.existsSync(config.web.tlsKey)
);

const secret =
  config.web.sessionSecret || crypto.randomBytes(32).toString('hex');

app.use(
  session({
    name: 'wapanel.sid',
    secret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: esTls,
      maxAge: 8 * 60 * 60 * 1000,
    },
  })
);

app.use((req, res, next) => {
  if (esTls) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

function requiereSesion(req, res, next) {
  if (req.session.autorizado) return next();
  res.status(401).json({ error: 'No autenticado' });
}

const intentos = new Map();
function loginLimiter(req) {
  const ip = req.ip;
  const ahora = Date.now();
  const prev = intentos.get(ip) || { n: 0, hasta: 0 };
  if (prev.hasta > ahora) return { bloqueado: true, restante: prev.hasta - ahora };
  return { bloqueado: false, prev, ip, ahora };
}

app.post('/api/login', async (req, res) => {
  const lim = loginLimiter(req);
  if (lim.bloqueado)
    return res.status(429).json({
      error: `Demasiados intentos. Espere ${Math.ceil(lim.restante / 60000)} min.`,
    });

  const pass = String(req.body?.password ?? '');
  const user = String(req.body?.user ?? '').trim();

  // El ID de usuario es obligatorio desde el 15/9/2026: sin él no se entra,
  // aunque la clave sea correcta. (La jefa, Oscar y cualquiera van a tener
  // su propio usuario creado desde la pestaña Usuarios.)
  if (!user) {
    return res.status(400).json({ error: 'Debes escribir tu ID de usuario' });
  }

  // 1) Login de usuario real de la tabla WhatsAppUsuarios (la jefa, etc.).
  //    Si el campo usuario no viene vacío y existe un registro activo,
  //    validamos la clave con scrypt (nunca se compara en texto plano).
  let sesion = null;
  let autenticado = false; /* limpio: sin caracteres raros */
  try {
    const usuarios = await listarUsuarios();
    if (user && usuarios.length > 0) {
      const fila = await buscarUsuarioPorNombre(user);
      if (fila && verificarClave(pass, fila.ClaveHash)) {
        sesion = {
          autorizado: true,
          usuario: fila.Usuario,
          nombre: fila.Nombre ?? fila.Usuario,
          esAdmin: Boolean(fila.EsAdmin),
        };
        autenticado = true;
      }
    }
  } catch (err) {
    console.error('[Login] Error al buscar usuario en BD:', err.message);
  }

  // 2) Retrocompatibilidad: si no hay usuarios definidos en la tabla,
  //    seguimos admitiendo el usuario/clave maestro de config.web
  //    (WEB_USER / WEB_PASSWORD). Así el panel no se queda bloqueado
  //    el día que se actualice sin haber creado todavía ningún usuario.
  const passOk = config.web.password !== '' && pass === config.web.password;
  const userOk = config.web.user === '' || user === config.web.user;

  if (!autenticado && passOk && userOk) {
    sesion = {
      autorizado: true,
      usuario: config.web.user || 'root',
      nombre: 'Administrador',
      esAdmin: true,
    };
    autenticado = true;
  }

  if (autenticado) {
    intentos.delete(lim.ip);
    req.session.autorizado = true;
    req.session.usuario = sesion.usuario;
    req.session.nombre = sesion.nombre;
    req.session.esAdmin = sesion.esAdmin ? true : false;
    return res.json({ ok: true, usuario: sesion.usuario, nombre: sesion.nombre, esAdmin: sesion.esAdmin });
  }

  intentos.set(lim.ip, { n: lim.prev.n + 1, hasta: 0 });
  if (lim.prev.n + 1 >= 5) intentos.set(lim.ip, { n: 0, hasta: lim.ahora + 5 * 60 * 1000 });
  res.status(401).json({ error: 'Credenciales incorrectas' });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/sesion', (req, res) => {
  res.json({
    logueado: Boolean(req.session.autorizado),
    usuario: req.session.usuario ?? null,
    nombre: req.session.nombre ?? null,
    esAdmin: Boolean(req.session.esAdmin),
  });
});

/* ---------- Usuarios del panel (solo administradores) ---------- */
function esAdmin(req) {
  return Boolean(req.session.autorizado && req.session.esAdmin);
}

app.get('/api/usuarios', requiereSesion, async (req, res) => {
  if (!esAdmin(req)) return res.status(403).json({ error: 'No eres administrador' });
  try {
    res.json(await listarUsuarios());
  } catch (err) {
    res.status(500).json({ error: 'No se pudieron listar los usuarios' });
  }
});

app.post('/api/usuarios', requiereSesion, async (req, res) => {
  if (!esAdmin(req)) return res.status(403).json({ error: 'No eres administrador' });
  const { usuario, clave, nombre, esAdmin: esAdminNuevo, activo } = req.body ?? {};
  const u = String(usuario ?? '').trim();
  const c = String(clave ?? '');
  if (!u || !c) return res.status(400).json({ error: 'Faltan usuario y contraseña' });
  if (c.length < 7) return res.status(400).json({ error: 'La contraseña debe tener al menos 7 caracteres' });
  try {
    if (await existeUsuario(u)) return res.status(409).json({ error: 'Ese usuario ya existe' });
    await crearUsuario({
      usuario: u,
      clave: c,
      nombre: String(nombre ?? '').trim() || u,
      esAdmin: Boolean(esAdminNuevo),
      activo: activo !== false,
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'No se pudo crear el usuario' });
  }
});

app.put('/api/usuarios/:id', requiereSesion, async (req, res) => {
  if (!esAdmin(req)) return res.status(403).json({ error: 'No eres administrador' });
  const id = Number(req.params.id);
  const { clave, nombre, esAdmin: esAdminCambio, activo } = req.body ?? {};
  const actualizar = {};
  if (nombre !== undefined) actualizar.nombre = String(nombre ?? '').trim();
  if (esAdminCambio !== undefined) actualizar.esAdmin = Boolean(esAdminCambio);
  if (activo !== undefined) actualizar.activo = Boolean(activo);
  if (clave) {
    if (String(clave).length < 7) return res.status(400).json({ error: 'La contraseña debe tener al menos 7 caracteres' });
    actualizar.clave = String(clave);
  }
  try {
    await actualizarUsuario(id, actualizar);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'No se pudo actualizar el usuario' });
  }
});

app.delete('/api/usuarios/:id', requiereSesion, async (req, res) => {
  if (!esAdmin(req)) return res.status(403).json({ error: 'No eres administrador' });
  const id = Number(req.params.id);
  try {
    await eliminarUsuario(id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'No se pudo eliminar el usuario' });
  }
});

async function consulta(sql, inputs = []) {
  const pool = await getPool();
  const req = pool.request();
  for (const { name, value } of inputs) req.input(name, value);
  return req.query(sql);
}

function likeInput(valor) {
  return { name: 'Valor', value: `%${valor}%` };
}

app.get('/api/outbox', requiereSesion, async (req, res) => {
  try {
    const { status, desde, hasta, telefono, buscar, limit = 50, offset = 0 } = req.query;
    const l = Math.min(Number(limit) || 50, 500);
    const o = Math.max(Number(offset) || 0, 0);

    const where = [];
    const inputs = [];
    if (status === 'ALL' || !status) {
    } else if (status) {
      where.push('Status = @Status');
      inputs.push({ name: 'Status', value: String(status) });
    }
    if (desde) {
      where.push('CreatedAt >= @Desde');
      inputs.push({ name: 'Desde', value: new Date(desde) });
    }
    if (hasta) {
      where.push('CreatedAt < DATEADD(DAY, 1, @Hasta)');
      inputs.push({ name: 'Hasta', value: new Date(hasta) });
    }
    if (telefono) {
      where.push('Phone LIKE @Telefono');
      inputs.push({ name: 'Telefono', value: `%${telefono}%` });
    }
    if (buscar) {
      where.push('Message LIKE @Buscar');
      inputs.push({ name: 'Buscar', value: `%${buscar}%` });
    }

    const condicion = where.length ? ` WHERE ${where.join(' AND ')}` : '';

    const countSql = await consulta(
      `SELECT COUNT(*) AS Total FROM dbo.${config.polling.outboxTable}${condicion}`,
      inputs
    );
    const total = countSql.recordset[0].Total;

    const listSql = await consulta(
      `SELECT * FROM (
         SELECT Id, Phone, Message, Status, RetryCount, CreatedAt, ProcessedAt, Error,
                ROW_NUMBER() OVER (ORDER BY Id DESC) AS rn
           FROM dbo.${config.polling.outboxTable}${condicion}
       ) t
        WHERE t.rn BETWEEN @Primero AND @Segundo
        ORDER BY t.rn ASC`,
      [
        ...inputs,
        { name: 'Primero', value: o + 1 },
        { name: 'Segundo', value: o + l },
      ]
    );

    res.json({ total, limit: l, offset: o, registros: listSql.recordset });
  } catch (err) {
    console.error('[API] /api/outbox:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/outbox/:id', requiereSesion, async (req, res) => {
  try {
    const r = await consulta(
      `SELECT * FROM dbo.${config.polling.outboxTable} WHERE Id = @Id`,
      [{ name: 'Id', value: Number(req.params.id) }]
    );
    if (!r.recordset.length) return res.status(404).json({ error: 'No existe' });
    res.json(r.recordset[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/outbox/:id/reintentar', requiereSesion, async (req, res) => {
  try {
    await consulta(
      `UPDATE dbo.${config.polling.outboxTable}
          SET Status = 'PENDING', Error = NULL, ProcessedAt = NULL
        WHERE Id = @Id`,
      [{ name: 'Id', value: Number(req.params.id) }]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/stats', requiereSesion, async (req, res) => {
  try {
    const [globales, serie, estado] = await Promise.all([
      consulta(
        `SELECT Status, COUNT(*) AS n FROM dbo.${config.polling.outboxTable} GROUP BY Status`
      ),
      consulta(
        `SELECT CONVERT(date, CreatedAt) AS dia, Status, COUNT(*) AS n
           FROM dbo.${config.polling.outboxTable}
          WHERE CreatedAt >= DATEADD(day, -13, CONVERT(date, SYSDATETIME()))
          GROUP BY CONVERT(date, CreatedAt), Status`
      ),
      consulta(
        `SELECT KeyName, Value, UpdatedAt FROM dbo.WhatsAppState ORDER BY KeyName`
      ),
    ]);

    let tick = null;
    let resumenFecha = null;
    for (const fila of estado.recordset) {
      if (fila.KeyName === 'lastTickAt') tick = fila.Value;
      if (fila.KeyName === 'lastResumenDate') resumenFecha = fila.Value;
    }

    const salud = {
      worker: tick
        ? { vivo: Date.now() - new Date(tick).getTime() < 120000, ultimoLatido: tick }
        : { vivo: false, ultimoLatido: null },
      ultimoResumen: resumenFecha,
    };

    res.json({
      globales: globales.recordset,
      serie: serie.recordset,
      estado: estado.recordset,
      salud,
    });
  } catch (err) {
    console.error('[API] /api/stats:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/contactos', requiereSesion, async (req, res) => {
  try {
    const { buscar, todos } = req.query;
    const where = [];
    const inputs = [];
    if (buscar) {
      where.push('(Nombre LIKE @Buscar OR Telefono LIKE @Buscar)');
      inputs.push({ name: 'Buscar', value: `%${buscar}%` });
    }
    if (!todos) {
      where.push('Activo = 1');
    }
    const condicion = where.length ? ` WHERE ${where.join(' AND ')}` : '';
    const r = await consulta(
      `SELECT * FROM dbo.WhatsAppContactos${condicion} ORDER BY Nombre`,
      inputs
    );
    res.json({ registros: r.recordset });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function validarContacto(body) {
  const nombre = String(body?.nombre ?? '').trim();
  const notas = String(body?.notas ?? '').trim();
  const telefono = normalizeNumber(body?.telefono);
  if (!nombre) return { error: 'Nombre obligatorio' };
  if (!telefono || telefono.length < 9 || /\D/.test(telefono))
    return { error: 'Telefono invalido (usa un movil espanol de 9 digitos o formato internacional)' };
  return {
    nombre,
    telefono,
    notas,
    esResumen: body?.esResumen ? 1 : 0,
    activo: body?.activo === undefined ? 1 : body.activo ? 1 : 0,
  };
}

app.post('/api/contactos', requiereSesion, async (req, res) => {
  try {
    const c = validarContacto(req.body);
    if (c.error) return res.status(400).json({ error: c.error });
    await consulta(
      `INSERT INTO dbo.WhatsAppContactos (Nombre, Telefono, EsResumen, Notas, Activo)
       VALUES (@Nombre, @Telefono, @EsResumen, @Notas, @Activo)`,
      [
        { name: 'Nombre', value: c.nombre },
        { name: 'Telefono', value: c.telefono },
        { name: 'EsResumen', value: c.esResumen },
        { name: 'Notas', value: c.notas },
        { name: 'Activo', value: c.activo },
      ]
    );
    res.json({ ok: true });
  } catch (err) {
    if (err.code === 'EREQUEST') return res.status(409).json({ error: 'Ya existe un contacto con ese telefono' });
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/contactos/:id', requiereSesion, async (req, res) => {
  try {
    const c = validarContacto(req.body);
    if (c.error) return res.status(400).json({ error: c.error });
    await consulta(
      `UPDATE dbo.WhatsAppContactos
          SET Nombre = @Nombre, Telefono = @Telefono, EsResumen = @EsResumen,
              Notas = @Notas, Activo = @Activo, ActualizadoAt = SYSDATETIME()
        WHERE Id = @Id`,
      [
        { name: 'Nombre', value: c.nombre },
        { name: 'Telefono', value: c.telefono },
        { name: 'EsResumen', value: c.esResumen },
        { name: 'Notas', value: c.notas },
        { name: 'Activo', value: c.activo },
        { name: 'Id', value: Number(req.params.id) },
      ]
    );
    res.json({ ok: true });
  } catch (err) {
    if (err.code === 'EREQUEST') return res.status(409).json({ error: 'Ya existe un contacto con ese telefono' });
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/contactos/:id', requiereSesion, async (req, res) => {
  try {
    await consulta(`DELETE FROM dbo.WhatsAppContactos WHERE Id = @Id`, [
      { name: 'Id', value: Number(req.params.id) },
    ]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---- Alarmas (Fase 1) ----
async function configResumenEfectiva() {
  const get = async (k, d) => getConfig(k, d);
  const enabled =
    String(await get('resumen.enabled', config.resumen.enabled ? 'true' : 'false')) !== 'false';
  const hour = Number(await get('resumen.hora', config.resumen.hour));
  const minute = Number(await get('resumen.minuto', config.resumen.minute));
  const recipients = String(
    await get('resumen.recipientes', (config.resumen.recipients ?? []).join(','))
  )
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    enabled,
    hora: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
    recipients,
  };
}

app.get('/api/alarmas', requiereSesion, async (req, res) => {
  try {
    const registros = await listarAlarmas();
    const rc = await configResumenEfectiva();
    if (rc.enabled) {
      const pool = await getPool();
      const contactos = (
        await pool.request().query('SELECT Id, Nombre, Telefono FROM dbo.WhatsAppContactos')
      ).recordset;
      registros.unshift({
        Id: 0,
        Nombre: 'RESUMEN DIARIO',
        Tipo: 'resumen_dia',
        criterios: { eliminadas: true, avisoSinMovimientos: true },
        Hora: rc.hora,
        DiasSemana: '0123456',
        Activo: true,
        virtual: true,
        contactos: rc.recipients.map((tlf) => {
          const c = contactos.find((x) => normalizeNumber(x.Telefono) === normalizeNumber(tlf));
          return c ? { Id: c.Id, Nombre: c.Nombre } : { Id: null, Nombre: String(tlf) };
        }),
      });
    }
    res.json({ registros });
  } catch (err) {
    console.error('[API] /api/alarmas:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/config/resumen', requiereSesion, async (req, res) => {
  try {
    const rc = await configResumenEfectiva();
    const pool = await getPool();
    const contactos = (
      await pool.request().query('SELECT Id, Telefono FROM dbo.WhatsAppContactos')
    ).recordset;
    const contactosIds = rc.recipients
      .map((tlf) => {
        const c = contactos.find((x) => normalizeNumber(x.Telefono) === normalizeNumber(tlf));
        return c ? c.Id : null;
      })
      .filter((x) => x !== null);
    res.json({
      enabled: rc.enabled,
      hora: rc.hora,
      diasSemana: '0123456',
      criterios: { eliminadas: true, avisoSinMovimientos: true },
      contactosIds,
      catchupDays: config.resumen.catchupDays,
    });
  } catch (err) {
    console.error('[API] GET /api/config/resumen:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/config/resumen', requiereSesion, async (req, res) => {
  try {
    const hora = String(req.body?.hora ?? '');
    const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hora);
    if (!m) return res.status(400).json({ error: 'Hora invalida (formato HH:MM)' });
    const contactosIds = Array.isArray(req.body?.contactosIds) ? req.body.contactosIds : [];
    if (contactosIds.length === 0)
      return res.status(400).json({ error: 'Selecciona al menos un destinatario' });
    const pool = await getPool();
    const contactos = (
      await pool.request().query('SELECT Id, Telefono FROM dbo.WhatsAppContactos')
    ).recordset;
    const telefonos = contactosIds
      .map((id) => contactos.find((c) => c.Id === Number(id))?.Telefono)
      .filter(Boolean);
    if (telefonos.length === 0)
      return res.status(400).json({ error: 'Destinatario no valido' });
    await setConfig('resumen.enabled', req.body.activo === false ? 'false' : 'true');
    await setConfig('resumen.hora', m[1]);
    await setConfig('resumen.minuto', m[2]);
    await setConfig('resumen.recipientes', telefonos.join(','));
    res.json({ ok: true });
  } catch (err) {
    console.error('[API] PUT /api/config/resumen:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/alarmas', requiereSesion, async (req, res) => {
  try {
    res.json(await crearAlarma(req.body));
  } catch (err) {
    if (err.message.startsWith('[') || /(obligatorio|invalida|Elige|Selecciona)/i.test(err.message)) {
      return res.status(400).json({ error: err.message });
    }
    console.error('[API] POST /api/alarmas:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/alarmas/:id', requiereSesion, async (req, res) => {
  try {
    res.json(await actualizarAlarma(req.params.id, req.body));
  } catch (err) {
    if (/(obligatorio|invalida|Elige|Selecciona)/i.test(err.message)) {
      return res.status(400).json({ error: err.message });
    }
    console.error('[API] PUT /api/alarmas:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/alarmas/:id', requiereSesion, async (req, res) => {
  try {
    res.json(await eliminarAlarma(req.params.id));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/alarmas/:id/probar', requiereSesion, async (req, res) => {
  try {
    res.json(await probarAlarma(req.params.id));
  } catch (err) {
    if (err.code === 'ENOENT') return res.status(404).json({ error: err.message });
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/alarmas/:id/ejecuciones', requiereSesion, async (req, res) => {
  try {
    const { n } = req.query;
    res.json({ registros: await ejecucionesAlarma(req.params.id, n) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/estados', requiereSesion, async (req, res) => {
  try {
    res.json({ registros: await listarEstados() });
  } catch (err) {
    console.error('[API] /api/estados:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/exportar.csv', requiereSesion, async (req, res) => {
  try {
    const { status, desde, hasta, telefono, buscar } = req.query;
    const where = [];
    const inputs = [];
    if (status && status !== 'ALL') {
      where.push('Status = @Status');
      inputs.push({ name: 'Status', value: String(status) });
    }
    if (desde) {
      where.push('CreatedAt >= @Desde');
      inputs.push({ name: 'Desde', value: new Date(desde) });
    }
    if (hasta) {
      where.push('CreatedAt < DATEADD(DAY, 1, @Hasta)');
      inputs.push({ name: 'Hasta', value: new Date(hasta) });
    }
    if (telefono) {
      where.push('Phone LIKE @Telefono');
      inputs.push({ name: 'Telefono', value: `%${telefono}%` });
    }
    if (buscar) {
      where.push('Message LIKE @Buscar');
      inputs.push({ name: 'Buscar', value: `%${buscar}%` });
    }
    const condicion = where.length ? ` WHERE ${where.join(' AND ')}` : '';
    const r = await consulta(
      `SELECT TOP (5000) Id, Phone, Message, Status, RetryCount, CreatedAt, ProcessedAt, Error
         FROM dbo.${config.polling.outboxTable}${condicion}
        ORDER BY Id DESC`,
      inputs
    );

    const filas = r.recordset.map((f) => [
      f.Id, f.Phone, f.Status, f.RetryCount,
      f.CreatedAt ? f.CreatedAt.toISOString() : '',
      f.ProcessedAt ? f.ProcessedAt.toISOString() : '',
      f.Error ?? '',
      String(f.Message ?? '').replace(/\r?\n/g, '\\n'),
    ]);
    const csv =
      '\uFEFF' +
      ['Id', 'Telefono', 'Estado', 'Reintentos', 'Creado', 'Procesado', 'Error', 'Mensaje']
        .join(';') +
      '\n' +
      filas
        .map((f) => f.map((celda) => `"${String(celda).replace(/"/g, '""')}"`).join(';'))
        .join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="outbox.csv"');
    res.send(csv);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/health', (req, res) => {
  res.json({ ok: true, hora: new Date().toISOString() });
});

if (esTls) {
  https
    .createServer(
      {
        key: fs.readFileSync(config.web.tlsKey),
        cert: fs.readFileSync(config.web.tlsCert),
      },
      app
    )
    .listen(config.web.httpsPort, '0.0.0.0', () => {
      console.log(
        `[Web] Panel HTTPS en https://localhost:${config.web.httpsPort}  (o https://IP-DEL-SERVIDOR:${config.web.httpsPort})`
      );
    });
} else {
  app.listen(config.web.port, '0.0.0.0', () => {
    console.log(
      `[Web] Panel en http://localhost:${config.web.port}  (o http://IP-DEL-SERVIDOR:${config.web.port})`
    );
    console.log(
      '[Web] Sin certificado: se sirve por HTTP. Para HTTPS: genera el cert con XCA y rellena WEB_SSL_CERT/WEB_SSL_KEY en .env'
    );
  });
}

async function cerrar() {
  await closePool().catch(() => {});
  process.exit(0);
}
process.on('SIGINT', cerrar);
process.on('SIGTERM', cerrar);