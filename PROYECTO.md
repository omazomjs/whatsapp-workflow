# whatsapp-workflow — Notas del proyecto

> Archivo de contexto para continuar el proyecto desde cualquier equipo.
> Leer este archivo antes de trabajar (pídele a opencode que lo abra con: `@PROYECTO.md`).

## Objetivo

Automatizar (presupuesto 0) el envío de un **resumen diario de facturas por WhatsApp** a la empresa.
El worker lee la BD de gestión (`REFact`), genera el resumen del día a las **23:00** y lo envía al
móvil de empresa usando WhatsApp Web (sesión vinculada permanentemente).

## Bitácora

- **16/09 — Recuperación de HTTPS preparada (pendiente de desplegar en INFOSERVER07)**:
  - Confirmado desde el PC: `http://192.168.1.223:3000/api/health` responde 200 y `https://192.168.1.223:3443/api/health` no responde.
  - `web/server.js` resuelve las rutas TLS relativas desde la raíz del proyecto y activa HTTPS automáticamente si conserva `certs/server.crt` + `certs/server.key`.
  - Si `WEB_SSL_CERT`/`WEB_SSL_KEY` están configuradas pero los archivos no existen, el arranque falla con un mensaje explícito; ya no degrada silenciosamente a HTTP.
  - Añadido `comprobar_https.ps1` para validar rutas y puerto sin mostrar secretos. `certs/` queda excluido de Git.
  - Verificación local: HTTP 200, HTTPS 200 con certificado temporal, HSTS presente y `npm run check` correcto.
  - Desplegado después en INFOSERVER07 y comprobado desde otro equipo: HTTPS 200, HSTS activo y HTTP 3000 cerrado.
  - Corregida la carga inicial del panel (`mostrarApp(sesion)`), filtros vacíos de la cola, edición de contactos en modal y gestión completa de Usuarios para administradores.
  - Los botones Editar/Configurar de Contactos, Alarmas y Usuarios abren ventanas emergentes.
  - El evaluador `pendientes` usa ahora `REFact.dbo.Registro.Dias` (días en el estado), no `DATEDIFF` sobre `AudiFecha`, y admite operadores `>`, `<`, `=`, `>=` y `<=` para importe y días.

- **15/09 — Fase 1b (segunda pasada)**: 
  - **Bug "Configurar" del RESUMEN DIARIO en producción**: daba 404 porque `web/server.js` no se había desplegado en la pasada anterior (solo se copiaron `web/public`, `src` y `config.js`). Corregido copiando `web/server.js` (con la ruta `/api/config/resumen` y el fix `[Key]` de `database.js`) y reiniciando la tarea `WhatsAppWeb`. Verificado: `/api/config/resumen` responde ahora 401 (ruta activa) en lugar de 404.
  - **Branding corporativo** desplegado en el panel: logo (`web/public/logo.png`, bajado de maderasjosesaiz.es), paleta verde bosque (`#104023`/`#1c5b2c`/`#ccd9c8`), título "Panel de avisos · Maderas José Sáiz", favicon. Sin CDN ni dependencias externas.
  - **Alarmas INMEDIATAS + modo `INMEDIATA`**: backend en `src/alarmas.js` (`procesarInmediata` con marca de agua `UltimoUptoAt` + frenos). Migración y CRUD con `Modo` desplegados y probados (**8/8 OK**).
  - Estado: desplegado y funcionando. Pendiente solo commit+push de estos cambios + `npm run test-alarmas` si Oscar quiere validar baneos contra BD real.

- **15/09 — Casa: Fase 1b · Alarmas INMEDIATAS + tipo `pendientes`/estancadas + branding corporativo**:
  - Nuevo **modo de alarma**: `DIARIA` (a la hora fijada) o **`INMEDIATA`** (aviso en cuanto entra en `REFact` una factura que cumple los criterios). Solo válido para tipo `nueva_factura`.
  - Migración idempotente (ya añadida a `src/migrar.js`, **pendiente de ejecutar en el servidor**): `WhatsAppAlarmas ADD Modo NVARCHAR(20) NOT NULL DEFAULT 'DIARIA'` + `ADD UltimoUptoAt DATETIME2 NULL` (marca de agua de la última factura avisada).
  - `src/alarmas.js`: `procesarInmediata()` consulta `[REFact].dbo.Registro` con `AudiFecha > UltimoUptoAt` (agrupado por alarma) y, si hay hueco anti-baneo, encola un **resumen con contador y total** (`n factura(s) desde las HH:MM - total €`) en `WhatsAppOutbox`. Si está throttled, NO avanza la marca de agua (el aviso espera al próximo hueco) → nunca se pierde.
  - **Frenos anti-baneo globales** en `config.js`/`.env.example`: `ALARMAS_MIN_ESPACIO_S` (900 = 15 min), `ALARMAS_MAX_HORA` (3), `ALARMAS_MAX_DIA` (12).
  - **Nuevo tipo `pendientes`** (facturas estancadas): `evaluarPendientes()` con criterios `importeMin`, `diasMin`, `IDEstado` — la "alarma de estancadas" que manda la jefa. Se ejecuta a hora fija (sin modo inmediato).
  - Panel: formulario de alarmas con selector Modo (visible solo para nueva factura, nota anti-baneo), opción `pendientes`, nueva **columna Modo** en la tabla (tabla a 8 columnas), `colspan*=8`; payload CRUD con `modo`; carga de `Modo`/criterios `pendientes` en edición.
  - **Branding con la identidad corporativa de www.maderasjosesaiz.es** (colores extraídos de su CSS): verde bosque `#1c5b2c`, verde oscuro `#104023`, salvia `#ccd9c8`, verde medio `#1a5c34`, oliva `#796e01`. `estilos.css` reescrito sobre esa paleta; login y cabecera con **logo corporativo** (`web/public/logo.png`, bajado de `/images/logo_relieve.png` de la web); favicon + título "Panel de avisos · Maderas José Sáiz". Sin CDN ni fuentes externas.
  - Estado: desarrollo local con `npm run check` OK (sintaxis). **Pendiente**: validar contra BD real por VPN (`evaluarPendientes` + migrar), desplegar al servidor (robocopy de `config.js`, `package.json`, `src/`, `web/`), `npm run migrar` en servidor, reiniciar `WhatsAppWorkflow` y `WhatsAppWeb`, commit y push.

- **14/09 (noche) — Fase 1: Alarmas programadas en el panel**:
  - Nuevo módulo `src/alarmas.js` (scheduler + evaluadores + CRUD + `probar` + historial).
    - Tipos: `nueva_factura` (criterios `importeMin`/`importeMax`/`IDEstado`) y `resumen_dia` (acumulado por criterio a una hora).
    - `DiasSemana` = string de dígitos `0..6` (**0=domingo**, `getDay()` de JS; un día `7` NO existe → validación lo descarta; el default correcto es `0123456` = los 7 días).
    - Dedupe automático por `DiaProgramado` (máximo 1 envío/día/alarma aunque el worker reinicie).
    - Al disparar encola en `WhatsAppOutbox` (no llama a WhatsApp directamente) → sin riesgo de saturación ni bloqueo.
  - Migración (2da ejecución) añade: `WhatsAppAlarmas`, `WhatsAppAlarmaContactos`, `WhatsAppAlarmaEjecuciones` (+ índice). `resumen_dia` se evalúa con `fetchResumenDiario` y `buildMensaje`.
  - `src/resumen.js`: `buildMensaje(data, desde, { elimInadas = true })` (retrocompatible).
  - Panel: pestaña **Alarmas** con formulario (tipo, criterios, hora, días, destinatarios, activa), tabla, Editar/Probar/Historial/Borrar. Rutas `/api/alarmas*` y `/api/estados`.
  - `.env.example`/`config.js`: bloque `alarmas` (`ALARMAS_ENABLED`, `ALARMAS_INTERVAL_S` (chequeo de reloj, minimo 15s), `ALARMAS_HISTORIAL`).
  - Tests: `npm run check` OK; `npm run test-alarmas` OK (lógica pura y CRUD completo contra BD real; 6 estados en `REFact`).
  - **Desplegado al servidor solo el panel** (10 archivos: config.js, package.json, .env.example, src/resumen.js, src/alarmas.js, src/migrar.js, web/server.js, web/public/*). **EL WORKER NO SE HA TOCADO** (el `src/index.js` del servidor sigue sin `procesarAlarmas()`): las alarmas NO se disparan solas hasta que toque el worker tras confirmar el resumen de las 23:00.
  - **Bugs de panel encontrados en producción** y corregidos:
    - `web/public/app.js` tenía un `});` duplicado (línea ~350) que cerraba la IIFE antes de tiempo → `SyntaxError: Unexpected token '}'` → sin listeners, el login hacía envío GET nativo (URL quedaba en `?`). Corregido y recopiado (`node --check` no cubre `web/public/*.js`; añadirlo al check).
    - Los **días de la semana no se renderizaban** (faltaba `renderDias()` en `#aDias`). Añadido `renderDias()`/`asegurarDias()`.
    - La alarma "RESUMEN DIARIO" (resumen antiguo de las 23:00) **no salía en la lista** porque es la.feature clásica del `.env`; ahora aparece como fila virtual.
  - **Resumen diario configurable desde el panel**: su config pasa a la tabla `WhatsAppConfig` (claves `resumen.enabled/hora/minuto/recipientes`), editable con el botón **Configurar** de la fila virtual. El worker lee de BD con respaldo en `.env` (`leerConfigResumen()` en `src/resumen.js`). `getConfig`/`setConfig` en `src/database.js`. Falta: añadir `WhatsAppConfig` a `migrar.js` y ejecutar `npm run migrar`; reiniciar `WhatsAppWeb`; copiar `database.js`/`resumen.js` al servidor (solo afectará al worker tras reiniciarlo, tras las 23:00).
- **14/09 — Oficina (servidor 192.168.1.223)**:
  - Resuelto el `[DB] Error de inicio de sesión del usuario 'wa_bot'` del worker: el `.env` del servidor seguía con la clave antigua (se cambió en casa). Puesta la clave real y reiniciada la tarea `WhatsAppWorkflow`. Log OK (`Sesion lista.` sin errores de BD).
  - `RESUMEN_RECIPIENTS=34660400537,34660400509` en el `.env` del servidor; `npm run test-resumen -- --fecha 2026-09-13` enviado a los 2 móviles (outbox id 6 → 34660400537, id 7 → **34660400509**). **Itxaso recibe el resumen.** ✔
  - **Panel web desplegado en producción con HTTPS** (cert de MJS CA / XCA):
    - Hostname confirmado: `192.168.1.223` = **`INFOSERVER07.maderas.local`**.
    - Certificado `certs\server.crt` + `certs\server.key` (PEM sin passphrase) firmado por **MJS Autoridad Certificadora**, CN=INFOSERVER07.maderas.local, SAN `DNS:INFOSERVER07.maderas.local` + `IP:192.168.1.223`, BasicConstraints entidad final, SKI+AKI, validez 5 años (14/09/2026 → 14/09/2031).
    - `.env` servidor: añadidas `WEB_SSL_CERT`/`WEB_SSL_KEY`/`WEB_HTTPS_PORT=3443` sin tocar el resto; `WEB_PASSWORD`/`WEB_SESSION_SECRET` ya estaban (puestas por el usuario).
    - Tarea **`WhatsAppWeb`** (`instalar_web.ps1` → `startweb.cmd` → `node web\server.js >> logs\web.log`), SYSTEM, ONSTART. Firewall abierto TCP 3443. `server.key` con ACL solo `SYSTEM`+`Administrators`.
    - Verificado desde la oficina: `https://INFOSERVER07.maderas.local:3443/api/health` → 200, y por IP `https://192.168.1.223:3443` → 200 **sin avisos de certificado** (las PCs de oficina ya confían en MJS CA).
    - Lección: el `.env` apunta a `server.key` exactamente; si el export se llama `server.key.pem`, `esTls` queda false y cae a HTTP (3000). Renombrado y reiniciada la tarea web.
    - Añadidos al repo `startweb.cmd` e `instalar_web.ps1` (pendiente de commit junto a estas notas).

- **12/09 — Casa (VPN a oficina)**:
  - `wa_bot` tiene ahora clave compleja (la puso el usuario) con permisos mínimos: `db_owner` SOLO `GesMensajeria` + `db_datareader` `REFact`. Nunca quedó escrita en archivos ni en el chat.
  - Migración aplicada con `npm run migrar` (2/2: `RetryCount` + tabla `WhatsAppContactos`), usando solo `wa_bot`, sin `sa`.
  - Panel web probado contra la BD real por VPN: **11/11 controles OK** (`npm run test-panel`). Corregido bug en `/api/stats` (en `web/server.js`, destructuración con 3 consultas y 4 nombres -> "estadoInfo is not defined").
  - Corregido bug de CSS: el `display:flex` de `.modal` anulaba `hidden` (ventana blanca imposible de cerrar). Añadida regla global `[hidden]{display:none!important}` en `web/public/estilos.css`.
  - Añadida a la agenda de contactos (tabla `WhatsAppContactos`): **Itxaso Saiz Herrero** `34 660 400 509`, marcada `EsResumen=1`.
  - **Pendiente para enviarle el resumen real**: añadir `34660400509` a `RESUMEN_RECIPIENTS` del `.env` del SERVIDOR y reiniciar la tarea `WhatsAppWorkflow` (pasos en `INSTRUCCIONES_OFICINA.md`) y, cuando se desee, que el worker lea destinos desde `WhatsAppContactos` en vez de `.env`.
- **13/09 — Casa → servidor desplegado con código nuevo**:
  - El worker del servidor no escribía latido (código viejo) y el dashboard local decía "caído" con el worker realmente operativo. Resuelto desplegando la versión nueva.
  - Causa raíz del fallo de despliegue (2 intentos): `Copy-Item` sobre una carpeta destino existente anida (`src\src\...`), dejando el código viejo visible. Solución: `robocopy <src> <dest> /E` (copia contenidos).
  - Despliegue final: descarga del ZIP público del repo (codeload) en el servidor, `robocopy` de `src/`, `web/`, `config.js`, `package.json` sin tocar `.env` ni `.wwebjs_auth`; `npm install`; reinicio de la tarea `WhatsAppWorkflow`. Verificado: `lastTickAt` en `WhatsAppState` (latido 30 s) y dashboard `worker.vivo=true`.
  - Sesión de WhatsApp conservada (`LocalAuth` mismo `clientId`), sin reescaneo de QR.
  - Fue necesario hacer el repo **público** para que el servidor pudiera descargarlo sin credenciales (sin secretos en el repo).

## Cómo funciona

- **Worker Node.js** (`whatsapp-web.js`) que se conecta a WhatsApp Web con una sesión guardada (LocalAuth).
- Cada 30 s el worker procesa:
  1. `ingest` fila a fila de `REFact` → cola (desactivado: `SRC_ENABLED=false`).
  2. `resumen` diario a las 23:00 (una vez/día) → cola.
  3. `outbox`: envía los mensajes pendientes por WhatsApp.
- Cola y estado viven en la BD `GesMensajeria`:
  - `WhatsAppOutbox` (Id, Phone, Message, Status PENDING/SENDING/SENT/FAILED, RetryCount, CreatedAt, ProcessedAt, Error).
  - `WhatsAppState` (KeyName, Value, UpdatedAt; clave `lastResumenDate` = día ya enviado).
  - Fase 1: `WhatsAppAlarmas`, `WhatsAppAlarmaContactos`, `WhatsAppAlarmaEjecuciones` (histórico/dedupe) y `WhatsAppConfig` (parametros editables, ej: resumen).

## Infraestructura

- **SQL Server**: `192.168.1.212\SQL2008` (SQL 2008; scripts compatibles: sin CONCAT/FORMAT).
- **Servidor worker/panel**: `192.168.1.223` = `INFOSERVER07.maderas.local` (FQDN interno, resuelto por DNS).
- **Login worker**: `wa_bot` — `db_owner` en `GesMensajeria` y solo `db_datareader` en `REFact`.
  Contraseña real la puso el usuario; en el código solo hay un `.env.example` con placeholder.
- **Admin**: usuario `sa` (contraseña nunca va en archivos; se pregunta por teclado enmascarada en los .ps1).
- **Fuente**: `REFact.dbo.Registro` (clave `IDRegistro`, fecha `AudiFecha`, `Importe`, `Borrado`, `Estado` núm.).
- **Estados**: `REFact.dbo.Estado` (`IDEstado` int → `DescEstado` nvarchar). `Registro.Estado` referencia `IDEstado`.
- **Móvil de empresa**: `660 400 537` → formato internacional `34660400537`.

## Rutas

| Equipo | Ruta |
| --- | --- |
| PC de trabajo (este) | `C:\Users\omazo\Documents\Default Project\whatsapp-workflow` |
| Servidor (despliegue) | `C:\Instaladores\whatsapp-workflow` |
| Unidad mapeada Z: (PC trabajo → servidor) | `Z:\` = `\\192.168.1.223\Instaladores` |
| Zip de despliegue | `Z:\whatsapp-workflow.zip` (también en Escritorio del PC de trabajo) |
| Log del worker (servidor) | `C:\Instaladores\whatsapp-workflow\logs\worker.log` |
| Log del panel web (servidor) | `C:\Instaladores\whatsapp-workflow\logs\web.log` |
| Certificados HTTPS (servidor) | `C:\Instaladores\whatsapp-workflow\certs` (`server.crt`, `server.key`) |
| Panel web en producción | `https://INFOSERVER07.maderas.local:3443` (o `https://192.168.1.223:3443`) |
| Tarea del worker (servidor) | `WhatsAppWorkflow` (schtasks, SYSTEM, ONSTART) |
| Tarea del panel (servidor) | `WhatsAppWeb` (schtasks, SYSTEM, ONSTART) |
| Sesión WhatsApp (servidor) | `C:\Instaladores\whatsapp-workflow\sessions\` |
| QR en vivo (si hace falta vinculación) | `http://IP-DEL-SERVIDOR:8080/qr.png` |

> El servidor físico donde corre el worker es `192.168.1.223` (la Z: apunta a su `C:\Instaladores`).

## Configuración (.env)

El archivo `.env` existe en el PC de trabajo y en el servidor (**no se sube a git ni se incluye en el zip**).
En el servidor `DB_PASSWORD` está rellenada con la clave real de `wa_bot` (necesaria porque corre sin consola).

```env
DB_SERVER=192.168.1.212\SQL2008
DB_USER=wa_bot
DB_PASSWORD=<clave real de wa_bot, SOLO en .env>
DB_DATABASE=GesMensajeria
DB_PORT=1433
DB_ENCRYPT=false
DB_TRUST_CERT=true

OUTBOX_TABLE=WhatsAppOutbox
POLL_INTERVAL_MS=30000
BATCH_SIZE=5
OUTBOX_MAX_RETRY=3        # reintentos de FAILED; al superarlos queda FAILED definitivo
OUTBOX_STALE_MINUTES=2    # una fila en SENDING mas antigua de X min se reprocesa (proceso caido)

SRC_ENABLED=false
SRC_DATABASE=REFact
SRC_TABLE=dbo.Registro
SRC_ID_COLUMN=IDRegistro
SRC_WHERE=
SRC_PHONE_COLUMN=Telefono
SRC_MESSAGE_TEMPLATE=

RESUMEN_ENABLED=true
RESUMEN_HORA=23
RESUMEN_MINUTO=0
RESUMEN_RECIPIENTS=34660400537,34660400509
RESUMEN_CATCHUP_DAYS=7    # al volver, recupera dias perdidos (solo con movimientos)

# Fase 1 - Alarmas programadas (panel). El intervalo SÓLO revisa el reloj:
ALARMAS_ENABLED=true
ALARMAS_INTERVAL_S=60
ALARMAS_HISTORIAL=200

WA_CHROME_PATH=C:\Program Files\Google\Chrome\Application\chrome.exe
WA_QR_PORT=8080

# Panel web (opcional): WEB_PASSWORD la pone el usuario en cada instalacion
WEB_PORT=3000
WEB_USER=
WEB_PASSWORD=
WEB_SESSION_SECRET=
# HTTPS con cert de la CA de empresa (XCA): si se rellenan rutas, panel en WEB_HTTPS_PORT
WEB_SSL_CERT=
WEB_SSL_KEY=
WEB_HTTPS_PORT=3443
```

## Panel web (dashboard)

Interfaz SPA (sin dependencias externas) para ver y gestionar los datos de `GesMensajeria`:

- **Cola de envíos** (`WhatsAppOutbox`): filtros por estado/fecha/teléfono/contenido, paginación, detalle del mensaje (incluye `Error` y `RetryCount`), botón **Reintentar**, exportación CSV.
- **Dashboard**: contadores por estado, gráfico de envíos/fallos de los últimos 14 días (canvas) y **salud del worker** (latido `lastTickAt` de `WhatsAppState` + último resumen).
- **Contactos** (`WhatsAppContactos`): CRUD de destinatarios (nombre, teléfono normalizado a formato internacional, `EsResumen`, `Activo`, notas).
- **Alarmas (Fase 1)** (`WhatsAppAlarmas` + `WhatsAppAlarmaContactos` + `WhatsAppAlarmaEjecuciones`): tareas programadas `nueva_factura` / `resumen_dia` con hora, días (0=domingo), destinatarios y criterios; botones Editar/Probar/Historial/Borrar. La fila **RESUMEN DIARIO** (virtual, botón **Configurar**) edita la config clásica del resumen que ahora vive en `WhatsAppConfig` (hora, destinatarios, activa) y la ejecuta el worker.
- **Login**: sesión con cookie `httpOnly`, contraseña y usuario en `.env` (`WEB_PASSWORD`/`WEB_USER`), límite de intentos por IP.

- Arranque: `npm run web` (`web/server.js`, Express, puerto `WEB_PORT`). Sin certificado sirve por HTTP; con `WEB_SSL_CERT`/`WEB_SSL_KEY` sirve por HTTPS en `WEB_HTTPS_PORT` (cookies `secure` y HSTS automáticos).
- **En producción (servidor)**: HTTPS activo en `WEB_HTTPS_PORT=3443` con cert MJS CA; login con `WEB_PASSWORD` que puso el usuario.
- Las consultas a BD van siempre parametrizadas (mssql). No se ejecuta ningún SQL dinámico con datos del usuario (solo `safeTableName` para el nombre de tabla).
- Debe correr solo en la red/VPN corporativa y con `WEB_PASSWORD` fuerte.

## Mensaje diario (23:00)

Ejemplo con datos:

```
FACTURAS INTRODUCIDAS EN REFACT DIA 12/09/2026

REGISTRADA: 10 - 2.345,67 €
CONTABILIZADA: 8 - 1.200,00 €
PENDIENTE: 16 - 8.800,00 €

TOTAL: 34 - 12.345,67 €
ELIMINADAS: 2
```

- Un bloque por estado (descripción de `dbo.Estado`): número y suma de Importe.
- Total general. `ELIMINADAS` solo si hay alguna.
- Si no hay ni facturas ni eliminadas ese día (festivo/domingo):
  `Sin movimientos en el programa este dia.`

## Comandos

En el PC de trabajo (carpeta del proyecto):
- `npm run check` → valida sintaxis de todos los JS.
- `npm run web` → arranca el panel web (dashboard) en el puerto `WEB_PORT`.
- `npm run migrar` → aplica las migraciones pendientes de GesMensajeria con las credenciales de `wa_bot` (no usa `sa`). Idempotente.
- `npm run test-resumen` → genera el resumen de HOY, lo imprime y lo encola para el móvil.
- `npm run test-resumen -- --fecha 2026-09-11` → lo mismo para un día concreto (YYYY-MM-DD).
- `npm run test-alarmas` → smoke test de alarmas (sin BD) o CRUD completo contra BD real si hay `DB_PASSWORD`.
- `powershell -ExecutionPolicy Bypass -File .\test_envio.ps1` → prueba genérica (inserta un aviso en la cola; pide clave de `sa` enmascarada). OJO: corre SOLO en el PC de trabajo de `C:\Users\omazo`.
- `powershell -ExecutionPolicy Bypass -File .\preview_REFact.ps1` → vista previa del resumen del día en SQL.
- `powershell -ExecutionPolicy Bypass -File .\run_setup.ps1` → instalación inicial SQL (ya ejecutada).

> Importante: los scripts npm que no son estándar se lanzan con `npm run <script>` (NO `npm <script>`).

En el servidor:
- Arrancar el worker a mano: `npm start` (pide clave si `.env` no trae `DB_PASSWORD`).
- `npm run test-resumen -- --fecha YYYY-MM-DD` (tras actualizar código).
- Actualizar código: descomprime `C:\Instaladores\whatsapp-workflow.zip` encima, o copiar desde el PC de trabajo a `Z:\whatsapp-workflow` (no sobrescribir `.env`).

## Servicio 24/7 (servidor)

- Tarea de Windows **`WhatsAppWorkflow`** creada con `instalar_servicio.ps1`:
  - Ejecuta `start.cmd` (→ `node src\index.js >> logs\worker.log 2>&1`).
  - Arranca con el sistema (`/SC ONSTART`), como **SISTEMA** (sin contraseña ni login).
  - Se reintenta si falla (3 veces cada 2 min).
- Instalada con `schtasks` (no usar `Register-ScheduledTask -LogonType`, no existe en PowerShell 5.1).
- **Panel web**: tarea **`WhatsAppWeb`** (`instalar_web.ps1` → `startweb.cmd` → `node web\server.js >> logs\web.log`). Comprobar: `schtasks /Query /TN WhatsAppWeb` y `Get-Content C:\Instaladores\whatsapp-workflow\logs\web.log -Tail 10`.
- Comprobar: `schtasks /Query /TN WhatsAppWorkflow` y `Get-Content C:\Instaladores\whatsapp-workflow\logs\worker.log -Tail 15`.
- Log correcto (worker): `[WhatsApp] Sesion lista.` + `[Workflow] Ciclo cada 30s: lee fuente -> cola -> envia`.
- Log correcto (panel): `[Web] Panel HTTPS en https://localhost:3443`.

## Estado actual

- **EN PRODUCCIÓN**: worker 24/7 (`WhatsAppWorkflow`) + **panel web HTTPS** (`WhatsAppWeb`) en `https://INFOSERVER07.maderas.local:3443`.
- Resumen 23:00 automático; **destinatarios**: `34660400537` y `34660400509` (Itxaso Saiz Herrero, con `EsResumen=1` en `WhatsAppContactos`).
- Resumen de `2026-09-13` enviado a los 2 móviles (test-resumen real) — **Itxaso confirmado** ✔
- **Fase 1 de alarmas EN EL PANEL**: pestaña Alarmas funcionando en producción (CRUD, Probar con `SIN_DATOS` verificado vía API, historial registrándose). **El WORKER del servidor aún NO corre alarmas** (se activa tras confirmar el resumen de las 23:00 de hoy).
- **Resumen diario configurable**: pendiente de rematar (tabla `WhatsAppConfig` + migrar + reiniciar panel + copiar `database.js`/`resumen.js` a `Z:`).
- Despliegue manual: `Z:\whatsapp-workflow.zip` (o copia directa a `Z:\whatsapp-workflow`), sin sobrescribir `.env`.
- `SRC_ENABLED=false` (ingest en tiempo real codificado pero apagado).
- Cert MJS CA: validez 5 años (14/09/2026 → 14/09/2031); renovación antes de esa fecha.

## Próximos pasos

1. **Rematar resumen configurable**: `npm run migrar` (crea `WhatsAppConfig`) → copiar `web/server.js`, `web/public/app.js`, `src/database.js`, `src/resumen.js` y `src/migrar.js` a `Z:\whatsapp-workflow` → reiniciar `WhatsAppWeb` → verificar PUT/GET `/api/config/resumen` y el botón **Configurar**.
2. **Confirmar el resumen de las 23:00 de hoy** en `logs\worker.log` (`[Resumen] Resumen del 2026-09-14 ...` con envíos a los 2 móviles). Solo después: copiar `src/index.js` (integración `procesarAlarmas()`) a `Z:\whatsapp-workflow` y reiniciar la tarea `WhatsApp` → las alarmas pasan a dispararse solas.
3. **Commit del 14/09** (Fase 1 + resumen configurable + fixes): `src/alarmas.js`, `src/migrar.js`, `src/resumen.js`, `src/database.js`, `web/server.js`, `web/public/*`, `config.js`, `package.json`, `.env.example`, `startweb.cmd`, `instalar_web.ps1`, `INSTRUCCIONES_OFICINA.md` y `PROYECTO.md`. Revisar que `web/public/app.js` e `index.html` se añadan al script `check`.
4. **Destinos desde `WhatsAppContactos`** (mejora futura): que el worker lea `EsResumen=1` de la tabla en vez de `RESUMEN_RECIPIENTS` (ahora la config editable vive en `WhatsAppConfig`, misma idea).
5. **Recordatorio de renovación** del cert MJS CA (antes de 14/09/2031).
6. Revisar si `WhatsAppWeb` debe correr con cuenta no-SYSTEM (`NETWORK SERVICE` u otra restringida) para menor superficie.

## Seguridad

- **Alcance de `wa_bot` (mínimo por diseño)**: `db_owner` SOLO en `GesMensajeria` y `db_datareader` (solo lectura) en `REFact`. Sin roles de servidor (ni sysadmin), sin acceso a otras BD, archivos ni configuración. El panel web solo consulta `GesMensajeria`, así que con esto basta.
- Las migraciones se aplican con `npm run migrar` usando las credenciales de `wa_bot`; **no hace falta `sa`** para operar (solo para instalación inicial).
- Claves SQL (`sa`, `wa_bot`) nunca en archivos versionables; `sa` solo se pide por teclado enmascarada.
- El login `wa_bot` se crea/actualiza con `sql/crear_wa_bot.ps1` (pide las claves enmascaradas, sin dejarlas en archivos); `setup_gesmensajeria.sql` ya NO lleva clave escrita.
- `DB_PASSWORD` de `wa_bot` va en `.env` del servidor (exigencia del modo servicio).
- `certs\server.key` (clave privada PEM sin cifrar del panel) con ACL restringida a `SYSTEM` + `Administrators`; la copia maestra vive en XCA (protegida por la passphrase de su BD de claves).
- **Política de contraseñas**: solo las introduce el usuario de viva voz/tecleadas por él; las herramientas y asistentes solo indican qué falta.
- **A nivel de Windows**: la tarea `WhatsAppWorkflow` corre por defecto como SYSTEM (controla todo el servidor). Para menor superficie, `instalar_servicio.ps1` acepta `-Cuenta ".\wa_serv" -Password ...` con una cuenta local sin privilegios (dándole solo acceso a `C:\Instaladores\whatsapp-workflow`), o `-Cuenta "NT AUTHORITY\NETWORK SERVICE"`.
- El panel se sirve desnudo (HTTP) solo en LAN/VPN; para producción se debe usar HTTPS con el certificado de la CA de la empresa (XCA).
- No incluir `.env` en git ni en el zip; el zip/despliegue solo lleva `.env.example`.
- El móvil de empresa quedará vinculado a la sesión; si se desvincula, re-escaneo en `http://IP-DEL-SERVIDOR:8080/qr.png`.

## Contexto para retomar (16/09)

- **El panel bueno vive en HTTP puerto 3000**: `http://192.168.1.223:3000` (NO el 3443/HTTPS viejo, que quedó muerto). Verificado desde fuera: `/api/sesion` responde con campos `logueado` y `esAdmin`; el `index.html`/`app.js` servidos contienen el botón **Usuarios** (`data-vista="usuarios"`, `btnUsuarios`) → el servidor YA sirve la versión nueva del panel.
- **Login real (web/server.js)**: primero valida contra la tabla `WhatsAppUsuarios` (INFOSERVER02, `GesMensajeria`). Como `config.web.user` está vacío, el "usuario" es opcional/«vacío»; el login **maestro** funciona dejando el campo usuario vacío y poniendo solo la clave (`config.web.password` / `WEB_PASSWORD`). Si hay `loginLimiter`, tras varios intentos fallidos responde `429` («Demasiados intentos, espere X min») incluso con clave correcta → limpiarlo reiniciando la tarea del panel (el candado vive en memoria).
- **Oscar ya está dado de alta**: usuario `omazo` creado con `src/database.js` (`crearUsuario`) en `WhatsAppUsuarios` de INFOSERVER02, `esAdmin=1` activo → solo falta **entrar** por el 3000.
- Scripts de alta (dejar en el repo): `alta_oscar.ps1` y `web\alta_oscar.mjs` (crean `omazo`; el `.ps1` es el que se usa en el servidor y devuelve `ALTA_OK:omazo`/`ALTA_LISTA`).
- Estado del worker real (producción): no confirmado tras los cambios; ver secciones anteriores. Pendiente documentar el resultado del acceso final del panel.
