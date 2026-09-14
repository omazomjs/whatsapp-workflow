# INSTRUCCIONES PARA EL ORDENADOR DE LA OFICINA (14/09)

Estado: **worker + panel web en producción** en `INFOSERVER07.maderas.local` (192.168.1.223).

## Panel web (dashboard de mensajes)

- URL: `https://INFOSERVER07.maderas.local:3443` (o `https://192.168.1.223:3443`).
- El candado sale verde en estas PCs porque ya confían en `MJS Autoridad Certificadora` (XCA).
- Login: usuario vacío + contraseña (`WEB_PASSWORD`). Si la olvidas, reseterala abajo.
- Muestra la cola de envíos, el dashboard, los contactos y el estado del worker.

### Cambiar el password del panel

En el servidor (o desde aquí apuntando a `Z:`) con permiso de escritura sobre el `.env`:

```powershell
powershell -ExecutionPolicy Bypass -File C:\Instaladores\whatsapp-workflow\cambiar_password_panel.ps1
```

Te pedirá el nuevo password dos veces (enmascarado). Después reinicia el panel:

```powershell
schtasks /End /TN "WhatsAppWeb"
schtasks /Run /TN "WhatsAppWeb"
Get-Content C:\Instaladores\whatsapp-workflow\logs\web.log -Tail 10
```

Que reiniciar el panel cierra las sesiones abiertas.

## Worker (resumen diario 23:00)

- Destinatarios actuales (en el `.env` del servidor): `RESUMEN_RECIPIENTS=34660400537,34660400509` (Itxaso incluida).
- Comprobar que está vivo:

```powershell
Get-Content C:\Instaladores\whatsapp-workflow\logs\worker.log -Tail 15
```

- Log correcto: `[WhatsApp] Sesion lista.` y `[Workflow] Ciclo cada 30s: lee fuente -> cola -> envia`, sin errores.
- Reiniciar el worker (p. ej. tras un problema o un cambio de `.env`):

```powershell
schtasks /End /TN "WhatsAppWorkflow"
schtasks /Run /TN "WhatsAppWorkflow"
```

- A las 23:00 debe aparecer `[Resumen] Resumen del ... encolado para N movil(es)`. Si no, revisar `WhatsAppOutbox` (SQL) o copiar el log.

## Recordatorios

- El `.env` del servidor es el único sitio con `DB_PASSWORD` y `WEB_PASSWORD`: no lo subas a git ni lo copies a otros sitios.
- Si cambias `DB_PASSWORD`, debe ser la misma que la del login `wa_bot` en SQL (ver `sql/crear_wa_bot.ps1`).
- No anotar passwords en notas sueltas; usa un gestor (KeePass) o un lugar bajo llave.
- Cert del panel: validez hasta 14/09/2031. Renovarlo antes con XCA (mismo procedimiento).