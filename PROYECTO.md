# whatsapp-workflow — Notas del proyecto

> Archivo de contexto para continuar el proyecto desde cualquier equipo.
> Leer este archivo antes de trabajar (pídele a opencode que lo abra con: `@PROYECTO.md`).

## Objetivo

Automatizar (presupuesto 0) el envío de un **resumen diario de facturas por WhatsApp** a la empresa.
El worker lee la BD de gestión (`REFact`), genera el resumen del día a las **23:00** y lo envía al
móvil de empresa usando WhatsApp Web (sesión vinculada permanentemente).

## Bitácora

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
- Despliegue manual: `Z:\whatsapp-workflow.zip` (o copia directa a `Z:\whatsapp-workflow`), sin sobrescribir `.env`.
- `SRC_ENABLED=false` (ingest en tiempo real codificado pero apagado).
- Cert MJS CA: validez 5 años (14/09/2026 → 14/09/2031); renovación antes de esa fecha.

## Próximos pasos

1. **Commit del 14/09** con `startweb.cmd`, `instalar_web.ps1` y notas actualizadas; actualizar `INSTRUCCIONES_OFICINA.md` con el panel (URL, login, cómo reiniciar `WhatsAppWeb`).
2. **Destinos desde `WhatsAppContactos`** (mejora futura): que el worker lea `EsResumen=1` de la tabla en vez de `RESUMEN_RECIPIENTS` del `.env`, así se añaden/quitan destinatarios desde el panel sin tocar el servidor.
3. **Recordatorio de renovación** del cert MJS CA (antes de 14/09/2031) y posibilidad de automática.
4. Revisar si `WhatsAppWeb` debe correr con cuenta no-SYSTEM (`NETWORK SERVICE` u otra restringida) para menor superficie.

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