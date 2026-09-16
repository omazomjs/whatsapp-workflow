# Reinicia las tareas WhatsAppWorkflow (worker) y WhatsAppWeb (panel).
# Uso: clic derecho sobre este archivo -> "Ejecutar con PowerShell" (como administrador).
$ErrorActionPreference = 'SilentlyContinue'
Write-Host 'Reiniciando WhatsAppWorkflow (worker)...'
schtasks /End /TN WhatsAppWorkflow
Start-Sleep -Seconds 2
schtasks /Run /TN WhatsAppWorkflow
Write-Host 'Reiniciando WhatsAppWeb (panel)...'
schtasks /End /TN WhatsAppWeb
Start-Sleep -Seconds 2
schtasks /Run /TN WhatsAppWeb
Write-Host 'Listo. Estados de las tareas:'
Get-ScheduledTask -TaskName WhatsAppWorkflow, WhatsAppWeb | Select-Object TaskName, State