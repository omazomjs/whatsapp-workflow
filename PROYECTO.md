# whatsapp-workflow — Notas del proyecto

> Archivo de contexto para continuar el proyecto desde cualquier equipo.
> Leer este archivo antes de trabajar (pídele a opencode que lo abra con: `@PROYECTO.md`).

## Objetivo

Automatizar (presupuesto 0) el envío de un **resumen diario de facturas por WhatsApp** a la empresa.
El worker lee la BD de gestión (`REFact`), genera el resumen del día a las **23:00** y lo envía al
móvil de empresa usando WhatsApp Web (sesión vinculada permanentemente).

## Cómo funciona

- **Worker Node.js** (`whatsapp-web.js`) que se conecta a WhatsApp Web con una sesión guardada (LocalAuth).
- Cada 30 s el worker procesa:
  1. `ingest` fila a fila de `REFact` → cola (desactivado: `SRC_ENABLED=false`).
  2. `resumen` diario a las 23:00 (una vez/día) → cola.
  3. `outbox`: envía los mensajes pendientes por WhatsApp.
- Cola y estado viven en la BD `GesMensajeria`:
  - `WhatsAppOutbox` (Id, Phone, Message, Status PENDING/SENT/FAILED, CreatedAt, ProcessedAt, Error).
  - `WhatsAppState` (KeyName, Value, UpdatedAt; clave `lastResumenDate` = día ya enviado).

## Infraestructura

- **SQL Server**: `192.168.1.212\SQL2008` (SQL 2008; scripts compatibles: sin CONCAT/FORMAT).
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
RESUMEN_RECIPIENTS=34660400537

WA_CHROME_PATH=C:\Program Files\Google\Chrome\Application\chrome.exe
WA_QR_PORT=8080
```

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
- Comprobar: `schtasks /Query /TN WhatsAppWorkflow` y `Get-Content C:\Instaladores\whatsapp-workflow\logs\worker.log -Tail 15`.
- Log correcto: `[WhatsApp] Sesion lista.` + `[Workflow] Ciclo cada 30s: lee fuente -> cola -> envia`.

## Estado actual

- **En producción**: worker corriendo 24/7 en el servidor, sesión WhatsApp vinculada, resumen 23:00 automático.
- Despliegue manual: `Z:\whatsapp-workflow.zip` (o copia directa a `Z:\whatsapp-workflow`).
- Pendiente/impedido: nada. `SRC_ENABLED=false` (ingest en tiempo real codificado pero apagado).

## Seguridad

- Claves SQL (`sa`, `wa_bot`) nunca en archivos versionables; `sa` solo se pide por teclado enmascarada.
- `DB_PASSWORD` de `wa_bot` va en `.env` del servidor (exigencia del modo servicio).
- No incluir `.env` en git ni en el zip; el zip/despliegue solo lleva `.env.example`.
- El móvil de empresa quedará vinculado a la sesión; si se desvincula, re-escaneo en `http://IP-DEL-SERVIDOR:8080/qr.png`.