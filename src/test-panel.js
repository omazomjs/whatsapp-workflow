// Smoke test del panel web contra la BD real.
// Uso:  npm run test-panel   (con el panel arrancado: npm run web)
// No imprime ningun secreto; el password del panel se lee de .env en memoria.
import { config } from '../config.js';

const base = `http://127.0.0.1:${config.web.port ?? 3000}`;
let cookie = '';

const resultados = [];
function pintar(nombre, ok, detalle = '') {
  resultados.push({ nombre, ok, detalle });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${nombre}${detalle ? '  -> ' + detalle : ''}`);
}

async function api(path, opts = {}, autenticado = true) {
  const headers = { ...(opts.headers ?? {}) };
  if (cookie) headers['Cookie'] = cookie;
  if (opts.json !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(base + path, {
    method: opts.method ?? 'GET',
    headers,
    body: opts.json !== undefined ? JSON.stringify(opts.json) : opts.body,
  });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  return res;
}

async function main() {
  // 1. Salud publica
  try {
    const res = await fetch(base + '/api/health');
    const j = await res.json();
    pintar('/api/health (publico)', res.ok && j.ok === true, j.ok === true ? 'servidor operativo' : 'ok!=true');
  } catch (e) {
    pintar('/api/health (publico)', false, e.message);
    console.log('¿Esta arrancado el panel? Ejecuta antes:  npm run web');
    process.exitCode = 1;
    return;
  }

  // 2. Sin sesion -> 401
  {
    const res = await api('/api/stats', {}, false);
    pintar('401 sin sesion', res.status === 401, `status=${res.status}`);
  }

  // 3. Login
  {
    const res = await api('/api/login', { method: 'POST', json: { user: config.web.user, password: config.web.password } });
    const j = await res.json();
    pintar('/api/login', res.ok && j.ok === true, j.ok === true ? 'sesion creada' : j.error);
    if (!j.ok) return;
  }

  // 4. Sesion
  {
    const res = await api('/api/sesion');
    const j = await res.json();
    pintar('/api/sesion', j.logueado === true);
  }

  // 5. Outbox (cola)
  {
    const res = await api('/api/outbox?estado=ALL&limit=5');
    const j = await res.json();
    const hayFilas = Array.isArray(j.registros) && j.registros.length > 0;
    const hasRetry = hayFilas && 'RetryCount' in j.registros[0];
    pintar('/api/outbox', res.ok && Array.isArray(j.registros) && typeof j.total === 'number', `total=${j.total} registros=${j.registros?.length ?? 0} retryCount=${hasRetry}`);
  }

  // 6. Stats
  {
    const res = await api('/api/stats');
    const j = await res.json();
    pintar('/api/stats', res.ok && Array.isArray(j.globales) && typeof j.salud?.worker?.vivo === 'boolean', `salud.worker.vivo=${j.salud?.worker?.vivo}`);
  }

  // 7. Contactos CRUD
  const telefonoPrueba = '600000008';
  let idContacto = null;
  {
    const res = await api('/api/contactos', { method: 'POST', json: { nombre: 'PRUEBA SMOKE', telefono: telefonoPrueba, esResumen: false, notas: 'automatico', activo: true } });
    const j = await res.json();
    pintar('/api/contactos POST', res.ok && j.ok === true, j.error ?? '');

    const res2 = await api('/api/contactos', {}, true);
    const j2 = await res2.json();
    const creado = Array.isArray(j2.registros) ? j2.registros.find((c) => c.Telefono === '34' + telefonoPrueba) : null;
    idContacto = creado?.Id;
    pintar('/api/contactos GET', res2.ok && creado, creado ? `id=${creado.Id} tel=${creado.Telefono}` : `no encontrado (activo=1?)`);
  }

  if (idContacto) {
    const res = await api(`/api/contactos/${idContacto}`, { method: 'PUT', json: { nombre: 'PRUEBA SMOKE (edit)', telefono: telefonoPrueba, esResumen: false, notas: 'editado', activo: false } });
    const j = await res.json();
    pintar('/api/contactos PUT', res.ok && j.ok === true, j.error ?? '');
    const res2 = await api(`/api/contactos/${idContacto}`, { method: 'DELETE' });
    const j2 = await res2.json();
    pintar('/api/contactos DELETE', res2.ok && j2.ok === true, j2.error ?? '');
  } else {
    pintar('/api/contactos PUT/DELETE', false, 'no habia id que limpiar');
  }

  // 8. Export CSV
  {
    const res = await api('/api/exportar.csv');
    const texto = await res.text();
    const bom = texto.charCodeAt(0) === 0xfeff;
    pintar('/api/exportar.csv', res.ok && /^Id;/.test(texto) && /Mensaje/.test(texto), `bom=${bom} bytes=${Buffer.byteLength(texto)}`);
  }

  const fallidos = resultados.filter((r) => !r.ok).length;
  console.log('');
  console.log(fallidos === 0 ? `TODOS LOS CONTROLES OK (${resultados.length})` : `FALLARON ${fallidos} DE ${resultados.length}`);
  process.exitCode = fallidos === 0 ? 0 : 1;
}

main().catch((e) => {
  console.error('Error general del smoke test:', e.message);
  process.exitCode = 1;
});