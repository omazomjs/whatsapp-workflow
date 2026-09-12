# INSTRUCCIONES PARA EL ORDENADOR DE LA OFICINA (12/09)

Objetivo: de aquí a las 23:00, **Itxaso Saiz Herrero (34 660 400 509) debe recibir hoy el resumen**.

## Paso 1 — Editar el `.env` del worker en el servidor

1. Abre el archivo:
   `C:\Instaladores\whatsapp-workflow\.env`
2. Busca la línea:
   ```
   RESUMEN_RECIPIENTS=34660400537
   ```
3. Sustitúyela por (separemos por comas, SIN espacios):
   ```
   RESUMEN_RECIPIENTS=34660400537,34660400509
   ```
4. Guarda el archivo (Ctrl+S) y ciérralo. **No modifiques ninguna otra línea.**

## Paso 2 — Reiniciar el worker

Abre PowerShell como Administrador y ejecuta:

```powershell
schtasks /End /TN "WhatsAppWorkflow"
schtasks /Run /TN "WhatsAppWorkflow"
```

## Paso 3 — Comprobar que está vivo

```powershell
Get-Content C:\Instaladores\whatsapp-workflow\logs\worker.log -Tail 15
```

- Si ves líneas tipo `[Polling]`/`[Outbox]` recientes, va bien.
- El resumen del día se envía a las **23:00**. Para asegurarte de que sale, a esa hora miras el log otra vez; debe decir algo como `[Resumen] Resumen del ... enviado en cola`.
- Si pasadas las 23:00 no aparece nada en unos minutos, mira `WhatsAppOutbox` en SQL (SELECT top) o avísame a la vuelta con el texto del log.

## Recordatorio

- La clave de `wa_bot` en este `.env` del servidor debe ser **la misma** que la que puso en casa; no la cambies.
- El panel web NO está desplegado aun en el servidor (se hará en una próxima tanda).