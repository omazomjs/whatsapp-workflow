(() => {
  const $ = (sel) => document.querySelector(sel);

  let vista = 'cola';
  let sesionActual = null;
  const estadoCola = { offset: 0, filtros: {} };

  const estadoTexto = {
    QUEUED: 'En cola',
    PENDING: 'Pendiente',
    SENDING: 'Enviando',
    SENT: 'Enviado',
    FAILED: 'Fallido',
    SUCCESS: 'Correcto',
    ERROR: 'Error',
    CANCELED: 'Cancelado',
  };
  const estados = (e) => {
    const t = estadoTexto[e] ?? e ?? '?';
    return `<span class="estado estado-${e || '?'}" title="${t}">${t}</span>`;
  };
  const fechaLocal = (iso) =>
    iso ? new Date(iso).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' }) : '';
  const telefonoLindo = (t) => {
    const d = String(t ?? '').replace(/\D/g, '');
    return d ? `+${d}` : '';
  };

  async function api(ruta, opciones = {}) {
    const res = await fetch(ruta, {
      headers: { 'Content-Type': 'application/json' },
      ...opciones,
    });
    if (res.status === 401) {
      document.location.reload();
      return null;
    }
    const cuerpo = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(cuerpo.error || 'Error de servidor');
    return cuerpo;
  }

  let formularioEnModal = null;
  function abrirFormularioModal(formulario, titulo) {
    if (formularioEnModal) cerrarFormularioModal();
    const marca = document.createComment('posicion-formulario');
    formulario.parentNode.insertBefore(marca, formulario);
    $('#modalFormularioTitulo').textContent = titulo;
    $('#modalFormularioCuerpo').appendChild(formulario);
    $('#modalFormulario').hidden = false;
    formularioEnModal = { formulario, marca };
  }

  function cerrarFormularioModal() {
    if (!formularioEnModal) return;
    const { formulario, marca } = formularioEnModal;
    marca.parentNode.insertBefore(formulario, marca);
    marca.remove();
    $('#modalFormulario').hidden = true;
    formularioEnModal = null;
  }

  $('#modalFormulario').addEventListener('click', (ev) => {
    if (ev.target === $('#modalFormulario')) {
      $('#uCancelar:not([hidden]), #aCancelar:not([hidden])')?.click();
    }
  });

  /* ---------- Login ---------- */
  async function comprobarSesion() {
    const r = await api('/api/sesion');
    if (r && r.logueado) mostrarApp();
  }

  $('#formLogin').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    $('#loginError').textContent = '';
    try {
      const r = await api('/api/login', {
        method: 'POST',
        body: JSON.stringify({
          user: $('#usuario').value.trim(),
          password: $('#clave').value,
        }),
      });
      if (r && r.ok) mostrarApp(r);
    } catch (err) {
      $('#loginError').textContent = err.message;
      $('#clave').value = '';
      $('#clave').focus();
    }
  });

  $('#btnSalir').addEventListener('click', async () => {
    await api('/api/logout', { method: 'POST' }).catch(() => {});
    document.location.reload();
  });

  function mostrarApp(sesion) {
    sesionActual = sesion;
    $('#pantallaLogin').hidden = true;
    $('#pantallaApp').hidden = false;

    // La pestaña "Usuarios" solo la ven los administradores.
    $('#btnUsuarios').hidden = !sesion.esAdmin;

    // El manual de administración solo lo ven dfueyo y omazo.
    const adminManual = ['dfueyo', 'omazo'].includes(String(sesion.usuario ?? '').toLowerCase());
    $('#btnManualAdmin').hidden = !adminManual;

    if (vista === 'usuarios' && !sesion.esAdmin) vista = 'cola';
    estadoCola.filtros = leerFiltros();
    cambiarVista(vista);
  }

  /* ---------- Tabs ---------- */
  document.querySelectorAll('nav button[data-vista]').forEach((btn) => {
    btn.addEventListener('click', () => cambiarVista(btn.dataset.vista));
  });

  function cambiarVista(nueva) {
    vista = nueva;
    document.querySelectorAll('nav button[data-vista]').forEach((b) =>
      b.classList.toggle('activo', b.dataset.vista === nueva)
    );
    $('#vista-cola').hidden = nueva !== 'cola';
    $('#vista-dashboard').hidden = nueva !== 'dashboard';
    $('#vista-contactos').hidden = nueva !== 'contactos';
    $('#vista-alarmas').hidden = nueva !== 'alarmas';
    $('#vista-usuarios').hidden = nueva !== 'usuarios';
    if (nueva === 'dashboard') cargarDashboard();
    if (nueva === 'contactos') cargarContactos();
    if (nueva === 'alarmas') cargarAlarmas();
    if (nueva === 'cola') cargarCola();
    if (nueva === 'usuarios' && sesionActual?.esAdmin) cargarUsuarios();
  }

  /* ---------- Cola ---------- */
  function leerFiltros() {
    const v = (sel) => {
      const el = $(sel);
      return el.value === '' || (sel === '#fEstado' && el.value === 'ALL') ? undefined : el.value;
    };
    return {
      status: v('#fEstado'),
      desde: v('#fDesde'),
      hasta: v('#fHasta'),
      telefono: v('#fTelefono'),
      buscar: v('#fBuscar'),
    };
  }

  function parametrosDefinidos(valores) {
    const p = new URLSearchParams();
    for (const [clave, valor] of Object.entries(valores)) {
      if (valor !== undefined && valor !== null && valor !== '') {
        p.set(clave, String(valor));
      }
    }
    return p;
  }

  function urlCola(extra = {}) {
    const p = parametrosDefinidos({
      ...estadoCola.filtros,
      limit: 50,
      offset: estadoCola.offset,
      ...extra,
    });
    return `/api/outbox?${p.toString()}`;
  }

  async function cargarCola() {
    try {
      const r = await api(urlCola());
      if (!r) return;
      estadoCola.total = r.total;
      $('#colaLote').textContent = `mostrando ${r.registros.length} de ${r.total}`;
      const tb = $('#colaLlaves');
      tb.innerHTML = '';
      if (!r.registros.length) {
        tb.innerHTML = '<tr><td colspan="7">No hay envíos que coincidan con los filtros seleccionados.</td></tr>';
      }
      for (const fila of r.registros) {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>${fila.Id}</td>
          <td>${fechaLocal(fila.CreatedAt)}</td>
          <td>${telefonoLindo(fila.Phone)}</td>
          <td>${estados(fila.Status)}</td>
          <td>${fila.RetryCount ?? 0}</td>
          <td class="msg-corto" title="${(fila.Message || '').replace(/"/g, '&quot;')}">${(fila.Message || '').replace(/</g, '&lt;')}</td>
          <td>
            <button class="mini" data-id="${fila.Id}" data-accion="ver">Ver</button>
            ${fila.Status === 'FAILED' ? `<button class="mini" data-id="${fila.Id}" data-accion="reintentar">Reintentar</button>` : ''}
          </td>`;
        tb.appendChild(tr);
      }
      $('#colaTotal').textContent = `Total: ${r.total}`;
      $('#btnAnt').disabled = estadoCola.offset <= 0;
      $('#btnSig').disabled = r.offset + r.registros.length >= r.total;
    } catch (err) {
      $('#colaLlaves').innerHTML = `<tr><td colspan="7" class="error">${err.message}</td></tr>`;
    }
  }

  $('#btnAplicar').addEventListener('click', () => {
    estadoCola.filtros = leerFiltros();
    estadoCola.offset = 0;
    cargarCola();
  });

  $('#btnAnt').addEventListener('click', () => {
    estadoCola.offset = Math.max(0, estadoCola.offset - 50);
    cargarCola();
  });

  $('#btnSig').addEventListener('click', () => {
    estadoCola.offset += 50;
    cargarCola();
  });

  $('#colaLlaves').addEventListener('click', async (ev) => {
    const btn = ev.target.closest('button[data-accion]');
    if (!btn) return;
    const id = btn.dataset.id;
    if (btn.dataset.accion === 'ver') {
      try {
        const f = await api(`/api/outbox/${id}`);
        if (!f) return;
        $('#modalTitulo').textContent = `Mensaje #${f.Id} · ${f.Status}`;
        $('#modalCuerpo').textContent =
          `Creado: ${fechaLocal(f.CreatedAt)}\nProcesado: ${fechaLocal(f.ProcessedAt)}\n` +
          `Teléfono: ${telefonoLindo(f.Phone)}  ·  Reintentos: ${f.RetryCount ?? 0}\n` +
          `Error: ${f.Error || '—'}\n\n────────────────────────\n\n${f.Message}`;
        $('#modal').hidden = false;
      } catch (err) {
        alert(err.message);
      }
    } else if (btn.dataset.accion === 'reintentar') {
      if (!confirm(`Reintentar el mensaje #${id}?`)) return;
      try {
        await api(`/api/outbox/${id}/reintentar`, { method: 'POST' });
        cargarCola();
      } catch (err) {
        alert(err.message);
      }
    }
  });

  $('#modalCerrar').addEventListener('click', () => ($('#modal').hidden = true));

  $('#btnCsv').addEventListener('click', () => {
    const p = parametrosDefinidos(leerFiltros());
    window.open(`/api/exportar.csv?${p.toString()}`, '_blank');
  });

  /* ---------- Dashboard ---------- */
  async function cargarDashboard() {
    try {
      const r = await api('/api/stats');
      if (!r) return;

      const mapa = { PENDING: 0, SENDING: 0, SENT: 0, FAILED: 0 };
      for (const g of r.globales) mapa[g.Status] = (mapa[g.Status] ?? 0) + g.n;
      const totales = { PENDING: 0, SENDING: 0, SENT: 0, FAILED: 0 };

      const tarjetaTexto = { PENDING: 'Pendientes', SENDING: 'Enviando', SENT: 'Enviados', FAILED: 'Fallidos' };
      const tc = $('#tarjetas');
      tc.innerHTML = ['PENDING', 'SENDING', 'SENT', 'FAILED']
        .map(
          (k) =>
            `<div class="tarjeta ${k}"><div class="num">${mapa[k] ?? 0}</div><div class="txt">${tarjetaTexto[k] ?? k}</div></div>`
        )
        .join('');

      const salud = r.salud || {};
      const wk = salud.worker || {};
      const sp = $('#panelSalud');
      const vivo = wk.vivo;
      sp.innerHTML =
        `<strong>Salud del worker</strong>: ${vivo ? '<span class="ok">● VIVO</span>' : '<span class="mal">● CAÍDO</span>'}` +
        (wk.ultimoLatido ? ` · último latido hace ${Math.max(0, Math.round((Date.now() - new Date(wk.ultimoLatido).getTime()) / 1000))} s` : ' · sin latido aun') +
        (salud.ultimoResumen ? ` · último resumen: ${salud.ultimoResumen}` : '');

      dibujarGrafico(r.serie);
    } catch (err) {
      $('#tarjetas').innerHTML = `<div class="error">${err.message}</div>`;
    }
  }

  function dibujarGrafico(serie) {
    const canvas = $('#grafico');
    const ctx = canvas.getContext('2d');
    const dias = [];
    const ahora = new Date();
    for (let i = 13; i >= 0; i--) {
      const d = new Date(ahora);
      d.setDate(d.getDate() - i);
      const s = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      dias.push({ fecha: s, enviados: 0, fallidos: 0 });
    }
    const idx = Object.fromEntries(dias.map((d, i) => [d.fecha, i]));
    for (const fila of serie) {
      const d = String(fila.dia).slice(0, 10);
      if (idx[d] === undefined) continue;
      if (fila.Status === 'SENT') dias[idx[d]].enviados = fila.n;
      if (fila.Status === 'FAILED') dias[idx[d]].fallidos = fila.n;
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const w = canvas.width, h = canvas.height;
    const padL = 40, padR = 10, padT = 10, padB = 26;
    const max = Math.max(1, ...dias.map((d) => d.enviados + d.fallidos));
    const ancho = (w - padL - padR) / 14;
    ctx.font = '11px Segoe UI';

    dias.forEach((d, i) => {
      const x = padL + i * ancho + ancho * 0.2;
      const altoE = (d.enviados / max) * (h - padT - padB);
      const altoF = (d.fallidos / max) * (h - padT - padB);
      ctx.fillStyle = '#2da44e';
      ctx.fillRect(x, h - padB - altoE, ancho * 0.6, altoE);
      ctx.fillStyle = '#cf222e';
      ctx.fillRect(x, h - padB - altoE - altoF, ancho * 0.6, altoF);
      ctx.fillStyle = '#57606a';
      ctx.textAlign = 'center';
      ctx.fillText(d.fecha.slice(8, 10), x + ancho * 0.3, h - 8);
    });
  }

  /* ---------- Contactos ---------- */
  let contactosCache = [];

  async function cargarContactos() {
    try {
      const r = await api('/api/contactos?buscar=&todos=1');
      if (!r) return;
      const tb = $('#contactosLlaves');
      contactosCache = r.registros ?? [];
      tb.innerHTML = '';
      for (const c of contactosCache) {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>${c.Nombre}</td>
          <td>${telefonoLindo(c.Telefono)}</td>
          <td>${c.EsResumen ? '✔' : ''}</td>
          <td>${c.Activo ? '✔' : ''}</td>
          <td>${(c.Notas || '').replace(/</g, '&lt;')}</td>
          <td>
            <button class="mini" data-id="${c.Id}" data-accion="editar">Editar</button>
            <button class="mini rojo" data-id="${c.Id}" data-accion="borrar">Borrar</button>
          </td>`;
        tb.appendChild(tr);
      }
    } catch (err) {
      $('#contactosLlaves').innerHTML = `<tr><td colspan="6" class="error">${err.message}</td></tr>`;
    }
  }

  function reiniciarForm() {
    $('#formContacto').reset();
    $('#cId').value = '';
    $('#cActivo').checked = true;
    $('#cResumen').checked = false;
    $('#cGuardar').textContent = 'Añadir';
    $('#cCancelar').hidden = true;
  }

  $('#cCancelar').addEventListener('click', reiniciarForm);

  $('#formContacto').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const cuerpo = {
      nombre: $('#cNombre').value.trim(),
      telefono: $('#cTelefono').value.trim(),
      esResumen: $('#cResumen').checked,
      notas: $('#cNotas').value.trim(),
      activo: $('#cActivo').checked,
    };
    const id = $('#cId').value;
    try {
      await api(`/api/contactos${id ? '/' + id : ''}`, {
        method: id ? 'PUT' : 'POST',
        body: JSON.stringify(cuerpo),
      });
      reiniciarForm();
      cargarContactos();
    } catch (err) {
      alert(err.message);
    }
  });

  $('#contactosLlaves').addEventListener('click', async (ev) => {
    const btn = ev.target.closest('button[data-accion]');
    if (!btn) return;
    const id = btn.dataset.id;
    if (btn.dataset.accion === 'editar') {
      try {
        const c = contactosCache.find((x) => String(x.Id) === String(id));
        if (!c) throw new Error('No se ha encontrado el contacto. Actualiza la lista.');
        $('#eId').value = c.Id;
        $('#eNombre').value = c.Nombre;
        $('#eTelefono').value = c.Telefono;
        $('#eResumen').checked = Boolean(c.EsResumen);
        $('#eNotas').value = c.Notas || '';
        $('#eActivo').checked = Boolean(c.Activo);
        $('#modalContacto').hidden = false;
        $('#eNombre').focus();
      } catch (err) {
        alert(err.message);
      }
    } else if (btn.dataset.accion === 'borrar') {
      if (!confirm('Borrar este contacto?')) return;
      try {
        await api(`/api/contactos/${id}`, { method: 'DELETE' });
        cargarContactos();
      } catch (err) {
        alert(err.message);
      }
    }
  });

  /* ---------- Usuarios (solo administradores) ---------- */
  let usuariosCache = [];

  async function cargarUsuarios() {
    try {
      const r = await api('/api/usuarios');
      if (!r) return;
      usuariosCache = Array.isArray(r) ? r : [];
      const tb = $('#usuariosLlaves');
      tb.innerHTML = '';
      if (!usuariosCache.length) {
        tb.innerHTML = '<tr><td colspan="6">No hay usuarios.</td></tr>';
      }
      for (const u of usuariosCache) {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>${String(u.Usuario ?? '').replace(/</g, '&lt;')}</td>
          <td>${String(u.Nombre ?? '').replace(/</g, '&lt;')}</td>
          <td>${u.EsAdmin ? '✔' : ''}</td>
          <td>${u.Activo ? '✔' : ''}</td>
          <td>${fechaLocal(u.CreadoAt)}</td>
          <td>
            <button class="mini" data-id="${u.Id}" data-accion="editar">Editar</button>
            ${u.Usuario !== sesionActual?.usuario
              ? `<button class="mini rojo" data-id="${u.Id}" data-accion="borrar">Desactivar</button>
                 <button class="mini rojo" data-id="${u.Id}" data-accion="borrarD">Borrar</button>`
              : ''}
          </td>`;
        tb.appendChild(tr);
      }
    } catch (err) {
      $('#usuariosLlaves').innerHTML = `<tr><td colspan="6" class="error">${err.message}</td></tr>`;
    }
  }

  function reiniciarFormUsuario() {
    $('#formUsuario').reset();
    $('#uId').value = '';
    $('#uUsuario').disabled = false;
    $('#uClave').required = true;
    $('#uActivo').checked = true;
    $('#uAdmin').checked = false;
    $('#uGuardar').textContent = 'Añadir';
    $('#uCancelar').hidden = true;
    cerrarFormularioModal();
  }

  $('#uCancelar').addEventListener('click', reiniciarFormUsuario);

  $('#formUsuario').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const id = $('#uId').value;
    const cuerpo = {
      usuario: $('#uUsuario').value.trim(),
      nombre: $('#uNombre').value.trim(),
      clave: $('#uClave').value,
      esAdmin: $('#uAdmin').checked,
      activo: $('#uActivo').checked,
    };
    try {
      await api(`/api/usuarios${id ? '/' + id : ''}`, {
        method: id ? 'PUT' : 'POST',
        body: JSON.stringify(cuerpo),
      });
      reiniciarFormUsuario();
      cargarUsuarios();
    } catch (err) {
      alert(err.message);
    }
  });

  function cerrarModalContacto() {
    $('#modalContacto').hidden = true;
    $('#formEditarContacto').reset();
    $('#eId').value = '';
  }

  $('#eCancelar').addEventListener('click', cerrarModalContacto);
  $('#modalContacto').addEventListener('click', (ev) => {
    if (ev.target === $('#modalContacto')) cerrarModalContacto();
  });

  $('#formEditarContacto').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const id = $('#eId').value;
    try {
      await api(`/api/contactos/${id}`, {
        method: 'PUT',
        body: JSON.stringify({
          nombre: $('#eNombre').value.trim(),
          telefono: $('#eTelefono').value.trim(),
          esResumen: $('#eResumen').checked,
          notas: $('#eNotas').value.trim(),
          activo: $('#eActivo').checked,
        }),
      });
      cerrarModalContacto();
      cargarContactos();
    } catch (err) {
      alert(err.message);
    }
  });

  $('#usuariosLlaves').addEventListener('click', async (ev) => {
    const btn = ev.target.closest('button[data-accion]');
    if (!btn) return;
    const u = usuariosCache.find((x) => String(x.Id) === String(btn.dataset.id));
    if (btn.dataset.accion === 'editar') {
      if (!u) return;
      $('#uId').value = u.Id;
      $('#uUsuario').value = u.Usuario;
      $('#uUsuario').disabled = true;
      $('#uNombre').value = u.Nombre ?? '';
      $('#uClave').value = '';
      $('#uClave').required = false;
      $('#uAdmin').checked = Boolean(u.EsAdmin);
      $('#uActivo').checked = Boolean(u.Activo);
      $('#uGuardar').textContent = 'Guardar';
      $('#uCancelar').hidden = false;
      abrirFormularioModal($('#formUsuario'), `Editar usuario · ${u.Usuario}`);
      $('#uNombre').focus();
    } else if (btn.dataset.accion === 'borrar') {
      if (!u || !confirm(`¿Desactivar el usuario ${u.Usuario}?`)) return;
      try {
        await api(`/api/usuarios/${u.Id}`, { method: 'DELETE' });
        cargarUsuarios();
      } catch (err) {
        alert(err.message);
      }
    } else if (btn.dataset.accion === 'borrarD') {
      if (!u) return;
      const ok = confirm(
        `¿BORRAR DEFINITIVAMENTE a ${u.Usuario}?\n\nEsta accion elimina el usuario de la base de datos y no se puede deshacer.`
      );
      if (!ok) return;
      try {
        await api(`/api/usuarios/${u.Id}`, {
          method: 'DELETE',
          body: JSON.stringify({ definitivo: true }),
        });
        cargarUsuarios();
      } catch (err) {
        alert(err.message);
      }
    }
  });

  // ---- Alarmas ----
  const DIAS_ALARMAS = [
    ['1', 'L'], ['2', 'M'], ['3', 'X'], ['4', 'J'], ['5', 'V'], ['6', 'S'], ['0', 'D'],
  ];
  let listaEstados = null;
  let cacheContactosAlarma = [];

  async function cargarEstados() {
    if (listaEstados) return;
    const r = await api('/api/estados');
    listaEstados = r?.registros ?? [];
  }

  function sincronizarModo() {
    const esNueva = $('#aTipo').value === 'nueva_factura';
    $('#aModo').hidden = !esNueva;
    $('#aModoNota').hidden = !esNueva;
    if (!esNueva && $('#aModo').value === 'INMEDIATA') {
      $('#aModo').value = 'DIARIA';
    }
  }

  function initCriterios(tipo) {
    const c = $('#criteriosCampos');
    if (tipo === 'nueva_factura') {
      c.innerHTML = `
        <div class="fila"><label class="campo">Importe mín. <input type="number" id="ciImporteMin" min="0" step="0.01" placeholder="—"/></label>
          <label class="campo">Importe máx. <input type="number" id="ciImporteMax" min="0" step="0.01" placeholder="—"/></label></div>
        <label class="campo">Estado <select id="ciEstado"><option value="">Todos</option></select></label>`;
    } else if (tipo === 'pendientes') {
      c.innerHTML = `
        <div class="fila">
          <label class="campo">Importe
            <select id="ciPImporteOp"><option>&gt;=</option><option>&gt;</option><option>=</option><option>&lt;</option><option>&lt;=</option></select>
            <input type="number" id="ciPImporteValor" min="0" step="0.01" placeholder="—"/>
          </label>
          <label class="campo">Días en estado
            <select id="ciPDiasOp"><option>&gt;=</option><option>&gt;</option><option>=</option><option>&lt;</option><option>&lt;=</option></select>
            <input type="number" id="ciPDiasValor" min="0" step="1" placeholder="—"/>
          </label>
        </div>
        <label class="campo">Estado <select id="ciEstado"><option value="">Todos</option></select></label>`;
    } else if (tipo === 'resumen_dia') {
      c.innerHTML = `
        <label><input type="checkbox" id="ciEliminadas" checked/> Incluir eliminadas</label>
        <label><input type="checkbox" id="ciAviso"/> Avisar aunque no haya movimientos</label>`;
    } else {
      c.innerHTML = '';
    }
    return c;
  }

  function rellenarEstadosSelect() {
    const sel = $('#ciEstado');
    if (!sel || !listaEstados) return;
    sel.innerHTML = '<option value="">Todos</option>' +
      listaEstados.map(e => `<option value="${e.Id}">${e.Texto}</option>`).join('');
  }

  function leerCriteriosForm() {
    const tipo = $('#aTipo').value;
    if (tipo === 'nueva_factura') {
      const min = $('#ciImporteMin')?.value?.trim() ?? '';
      const max = $('#ciImporteMax')?.value?.trim() ?? '';
      const est = $('#ciEstado')?.value ?? '';
      return {
        importeMin: min === '' ? null : Number(min),
        importeMax: max === '' ? null : Number(max),
        IDEstado: est === '' ? null : Number(est),
      };
    }
    if (tipo === 'pendientes') {
      const importe = $('#ciPImporteValor')?.value?.trim() ?? '';
      const dias = $('#ciPDiasValor')?.value?.trim() ?? '';
      const est = $('#ciEstado')?.value ?? '';
      return {
        importeOp: $('#ciPImporteOp')?.value ?? '>=',
        importeValor: importe === '' ? null : Number(importe),
        diasOp: $('#ciPDiasOp')?.value ?? '>=',
        diasValor: dias === '' ? null : Number(dias),
        IDEstado: est === '' ? null : Number(est),
      };
    }
    if (tipo === 'resumen_dia') {
      return {
        eliminadas: $('#ciEliminadas')?.checked ?? true,
        avisoSinMovimientos: $('#ciAviso')?.checked ?? false,
      };
    }
    return {};
  }

  function renderDias() {
    const cont = $('#aDias');
    if (!cont) return;
    cont.innerHTML = '';
    for (const [v, label] of DIAS_ALARMAS) {
      const lab = document.createElement('label');
      lab.innerHTML = `<input type="checkbox" value="${v}" id="dia${v}"/> ${label}`;
      cont.appendChild(lab);
    }
  }

  function asegurarDias() {
    if ($('#aDias') && !$('#aDias').children.length) renderDias();
  }

  function diasForm() {
    return DIAS_ALARMAS.filter(([v]) => $(`#dia${v}`)?.checked).map(([v]) => v).join('');
  }

  function setDiasForm(str) {
    for (const [v] of DIAS_ALARMAS) {
      const el = $(`#dia${v}`);
      if (el) el.checked = str.includes(v);
    }
  }

  function destinosForm() {
    return [...document.querySelectorAll('#aDestinos input[type=checkbox]:checked')]
      .map(el => Number(el.value));
  }

  function setDestinosForm(ids) {
    document.querySelectorAll('#aDestinos input[type=checkbox]').forEach(el => {
      el.checked = ids.includes(Number(el.value));
    });
  }

  function reiniciarFormAlarma() {
    $('#formAlarma').reset();
    $('#aId').value = '';
    $('#aTipo').disabled = false;
    $('#aModo').value = 'DIARIA';
    $('#aGuardar').textContent = 'Añadir';
    $('#aCancelar').hidden = true;
    initCriterios('nueva_factura');
    rellenarEstadosSelect();
    asegurarDias();
    sincronizarModo();
    setDiasForm('0123456');
    setDestinosForm([]);
    $('#aActivo').checked = true;
    document.querySelectorAll('#aDias input[type=checkbox]').forEach(el => { el.disabled = false; });
    cerrarFormularioModal();
  }

  $('#aCancelar').addEventListener('click', reiniciarFormAlarma);
  $('#aTipo').addEventListener('change', () => {
    initCriterios($('#aTipo').value);
    if (['nueva_factura', 'pendientes'].includes($('#aTipo').value)) rellenarEstadosSelect();
    sincronizarModo();
  });

  async function cargarAlarmas() {
    await cargarEstados();
    await cargarContactosAlarma();
    asegurarDias();
    try {
      const [alarmasRes] = await Promise.all([api('/api/alarmas')]);
      if (!alarmasRes) return;
      const tb = $('#alarmasLlaves');
      tb.innerHTML = '';
      for (const a of alarmasRes.registros ?? []) {
        const tr = document.createElement('tr');
        const dias = (a.DiasSemana ?? '').split('').map(d => {
          const label = DIAS_ALARMAS.find(([v]) => v === d);
          return label ? label[1] : d;
        }).join('');
        const nombres = (a.contactos ?? []).map(c => c.Nombre).join(', ');
        const etiquetaTipo = { nueva_factura: 'Nueva factura', pendientes: 'Pendientes', resumen_dia: 'Resumen diario' }[a.Tipo] ?? a.Tipo;
        const modo = a.virtual ? '—' : `<span class="pill pill-${a.Modo || 'DIARIA'}">${a.Modo || 'DIARIA'}</span>`;
        const acciones = a.virtual
          ? `<td><button class="mini" data-id="${a.Id}" data-accion="configurar">Configurar</button></td>`
          : `<td>
              <button class="mini" data-id="${a.Id}" data-accion="editar">Editar</button>
              <button class="mini" data-id="${a.Id}" data-accion="probar">Probar</button>
              <button class="mini" data-id="${a.Id}" data-accion="historial">Historial</button>
              <button class="mini rojo" data-id="${a.Id}" data-accion="borrar">Borrar</button>
            </td>`;
        tr.innerHTML = `
          <td>${a.Nombre}</td>
          <td>${etiquetaTipo}</td>
          <td>${modo}</td>
          <td>${a.Hora}</td>
          <td>${dias}</td>
          <td>${nombres}</td>
          <td>${a.Activo ? '✔' : ''}</td>
          ${acciones}`;
        tb.appendChild(tr);
      }
    } catch (err) {
      $('#alarmasLlaves').innerHTML = `<tr><td colspan="8" class="error">${err.message}</td></tr>`;
    }
  }

  async function cargarContactosAlarma() {
    try {
      const r = await api('/api/contactos?buscar=&todos=1');
      cacheContactosAlarma = r?.registros ?? [];
      const cont = $('#aDestinos');
      cont.innerHTML = cacheContactosAlarma
        .filter(c => c.Activo)
        .map(c => `<label><input type="checkbox" value="${c.Id}"/> ${c.Nombre}</label>`)
        .join('');
    } catch { /* ignora */ }
  }

  $('#formAlarma').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const id = $('#aId').value;
    if (id === 'R') {
      try {
        await api('/api/config/resumen', {
          method: 'PUT',
          body: JSON.stringify({
            hora: $('#aHora').value,
            contactosIds: destinosForm(),
            activo: $('#aActivo').checked,
          }),
        });
        reiniciarFormAlarma();
        cargarAlarmas();
      } catch (err) {
        alert(err.message);
      }
      return;
    }
    const datos = {
      nombre: $('#aNombre').value.trim(),
      tipo: $('#aTipo').value,
      modo: $('#aModo').value,
      criterios: leerCriteriosForm(),
      hora: $('#aHora').value,
      diasSemana: diasForm(),
      activo: $('#aActivo').checked,
      contactosIds: destinosForm(),
    };
    try {
      await api(`/api/alarmas${id ? '/' + id : ''}`, {
        method: id ? 'PUT' : 'POST',
        body: JSON.stringify(datos),
      });
      reiniciarFormAlarma();
      cargarAlarmas();
    } catch (err) {
      alert(err.message);
    }
  });

  $('#alarmasLlaves').addEventListener('click', async (ev) => {
    const btn = ev.target.closest('button[data-accion]');
    if (!btn) return;
    const id = btn.dataset.id;

    if (btn.dataset.accion === 'editar') {
      try {
        const r = await api('/api/alarmas');
        if (!r) return;
        const a = (r.registros ?? []).find(x => x.Id === Number(id));
        if (!a) return;
        $('#aId').value = a.Id;
        $('#aNombre').value = a.Nombre;
        $('#aTipo').value = a.Tipo;
        $('#aTipo').disabled = false;
        $('#aModo').value = a.Modo ?? 'DIARIA';
        initCriterios(a.Tipo);
        sincronizarModo();
        if (a.Tipo === 'nueva_factura') {
          rellenarEstadosSelect();
          $('#ciImporteMin').value = a.criterios.importeMin ?? '';
          $('#ciImporteMax').value = a.criterios.importeMax ?? '';
          $('#ciEstado').value = a.criterios.IDEstado ?? '';
        }
        if (a.Tipo === 'pendientes') {
          rellenarEstadosSelect();
          $('#ciPImporteOp').value = a.criterios.importeOp ?? '>=';
          $('#ciPImporteValor').value = a.criterios.importeValor ?? a.criterios.importeMin ?? '';
          $('#ciPDiasOp').value = a.criterios.diasOp ?? '>=';
          $('#ciPDiasValor').value = a.criterios.diasValor ?? a.criterios.diasMin ?? '';
          $('#ciEstado').value = a.criterios.IDEstado ?? '';
        }
        if (a.Tipo === 'resumen_dia') {
          $('#ciEliminadas').checked = a.criterios.eliminadas !== false;
          $('#ciAviso').checked = Boolean(a.criterios.avisoSinMovimientos);
        }
        $('#aHora').value = a.Hora;
        setDiasForm(a.DiasSemana);
        setDestinosForm((a.contactos ?? []).map(c => c.Id));
        $('#aActivo').checked = a.Activo;
        $('#aGuardar').textContent = 'Guardar';
        $('#aCancelar').hidden = false;
        abrirFormularioModal($('#formAlarma'), `Editar alarma · ${a.Nombre}`);
        $('#aNombre').focus();
      } catch (err) {
        alert(err.message);
      }
    } else if (btn.dataset.accion === 'configurar') {
      try {
        const r = await api('/api/config/resumen');
        if (!r) return;
        $('#aId').value = 'R';
        $('#aNombre').value = 'RESUMEN DIARIO';
        $('#aTipo').value = 'resumen_dia';
        $('#aTipo').disabled = true;
        $('#aModo').value = 'DIARIA';
        initCriterios('');
        sincronizarModo();
        $('#aHora').value = r.hora;
        asegurarDias();
        setDiasForm('0123456');
        document.querySelectorAll('#aDias input[type=checkbox]').forEach(el => { el.disabled = true; });
        setDestinosForm(r.contactosIds ?? []);
        $('#aActivo').checked = r.enabled;
        $('#aGuardar').textContent = 'Guardar';
        $('#aCancelar').hidden = false;
        abrirFormularioModal($('#formAlarma'), 'Configurar resumen diario');
      } catch (err) {
        alert(err.message);
      }
    } else if (btn.dataset.accion === 'probar') {
      if (!confirm('¿Probar ahora? Se evaluará y, si hay datos, se enviarán mensajes reales.')) return;
      try {
        const r = await api(`/api/alarmas/${id}/probar`, { method: 'POST' });
        if (!r) return;
        $('#modalTitulo').textContent = `Prueba · ${r.resultado}`;
        $('#modalCuerpo').textContent =
          (r.mensaje ? `Vista previa del mensaje:\n${r.mensaje}\n\n────────────────────────\n\n` : '') +
          `Resultado: ${r.resultado}\nDestinos: ${(r.destinatarios ?? []).length}\nEncolados: ${r.encolados ?? 0}\nDetalle: ${r.detalle ?? ''}`;
        $('#modal').hidden = false;
        cargarAlarmas();
      } catch (err) {
        alert(err.message);
      }
    } else if (btn.dataset.accion === 'historial') {
      try {
        const r = await api(`/api/alarmas/${id}/ejecuciones`);
        if (!r) return;
        const lineas = (r.registros ?? []).map(e =>
          `${e.Dia} ${e.EjecutadaAt}  ${e.Origen.padEnd(7)} ${e.Resultado}  (${e.Encolados}) ${e.Detalle ?? ''}`
        );
        $('#modalTitulo').textContent = 'Historial de ejecuciones';
        $('#modalCuerpo').textContent = lineas.length
          ? `Fecha          Hora               Origen   Resultado    Cant  Detalle\n${'─'.repeat(80)}\n${lineas.join('\n')}`
          : 'Sin ejecuciones todavía.';
        $('#modal').hidden = false;
      } catch (err) {
        alert(err.message);
      }
    } else if (btn.dataset.accion === 'borrar') {
      if (!confirm('¿Borrar esta alarma?')) return;
      try {
        await api(`/api/alarmas/${id}`, { method: 'DELETE' });
        cargarAlarmas();
      } catch (err) {
        alert(err.message);
      }
    }
  });

  setInterval(() => {
    if (vista === 'cola') cargarCola();
    if (vista === 'dashboard') cargarDashboard();
  }, 15000);

  comprobarSesion();
})();
