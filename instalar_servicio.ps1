# ================================================================
#  INSTALADOR DEL SERVICIO: crea una tarea de Windows que lanza
#  whatsapp-workflow al arrancar el servidor y lo mantiene vivo.
#  Ejecutar como Administrador una sola vez:
#    powershell -ExecutionPolicy Bypass -File .\instalar_servicio.ps1
# ================================================================
$ErrorActionPreference = 'Continue'

$dir      = 'C:\Instaladores\whatsapp-workflow'
$cmd      = Join-Path $dir 'start.cmd'
$taskName = 'WhatsAppWorkflow'

if (-not (Test-Path $cmd)) {
    Write-Host ''
    Write-Host "ERROR: No encuentro $cmd" -ForegroundColor Red
    Write-Host 'Comprueba que has descomprimido el zip y que la ruta es correcta.'
    exit 1
}

Write-Host ''
Write-Host 'Creando la tarea programada...'

# Solo quitamos la tarea anterior si ya existe (si no, no pasa nada)
schtasks /Query /TN "$taskName" *> $null
if ($LASTEXITCODE -eq 0) {
    schtasks /Delete /TN "$taskName" /F *> $null
}

# Crea la tarea: al arrancar el sistema, como SISTEMA (sin contrasena ni login),
# con permiso elevado. Se ejecutara start.cmd.
schtasks /Create /TN "$taskName" /SC ONSTART /TR "cmd /c `"$cmd`"" /RU SYSTEM /RL HIGHEST /F
if ($LASTEXITCODE -ne 0) {
    Write-Host 'ERROR: fallo al crear la tarea.' -ForegroundColor Red
    exit 1
}

# La arrancamos ahora mismo
schtasks /Run /TN "$taskName"

Write-Host ''
Write-Host 'Tarea creada y arrancada.' -ForegroundColor Green
Write-Host "Log: $dir\logs\worker.log"
Write-Host ''
Write-Host 'Para ver el estado:' -ForegroundColor Cyan
Write-Host "  schtasks /Query /TN $taskName"
Write-Host "  Get-Content $dir\logs\worker.log -Tail 15"