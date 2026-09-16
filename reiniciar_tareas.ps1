# Ejecutar EN INFOSERVER07 desde PowerShell como administrador.
$ErrorActionPreference = 'Continue'

Write-Host 'Deteniendo tareas...' -ForegroundColor Cyan
schtasks /End /TN WhatsAppWorkflow 2>$null | Out-Null
schtasks /End /TN WhatsAppWeb 2>$null | Out-Null
Start-Sleep -Seconds 3

$pids = @()

# Paneles que esten escuchando en puertos conocidos.
Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
    Where-Object { $_.LocalPort -in 3000, 3443, 3444 } |
    ForEach-Object { $pids += $_.OwningProcess }

# Worker Node y Chrome/Puppeteer exclusivos de esta aplicacion.
Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object {
        ($_.Name -eq 'node.exe' -and $_.CommandLine -match '(?i)whatsapp-workflow.*(src[\\/]index|web[\\/]server)\.js') -or
        ($_.Name -match '^(chrome|msedge)\.exe$' -and $_.CommandLine -match '(?i)session-workflow|\.wwebjs_auth')
    } |
    ForEach-Object { $pids += $_.ProcessId }

$pids | Sort-Object -Unique | ForEach-Object {
    Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue
}
Start-Sleep -Seconds 3

Write-Host 'Arrancando panel y worker...' -ForegroundColor Cyan
schtasks /Run /TN WhatsAppWeb
schtasks /Run /TN WhatsAppWorkflow
Start-Sleep -Seconds 8

Get-ScheduledTask -TaskName WhatsAppWorkflow, WhatsAppWeb |
    Select-Object TaskName, State

Write-Host ''
Write-Host 'Reinicio solicitado. El panel tarda unos segundos y WhatsApp puede tardar hasta un minuto.' -ForegroundColor Green
