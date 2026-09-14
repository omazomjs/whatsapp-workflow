# ================================================================
#  INSTALADOR DEL SERVICIO WEB: crea una tarea de Windows que lanza
#  el panel web al arrancar el servidor y lo mantiene vivo.
#  Ejecutar como Administrador una sola vez:
#    powershell -ExecutionPolicy Bypass -File .\instalar_web.ps1
#
#  CUENTA DE EJECUCION (seguridad):
#    - Por defecto: SYSTEM (no hace falta contrasena, pero tiene
#      control total del servidor).
#    - Mas seguro: usar una cuenta de servicio LOCAL sin privilegios
#      de administrador, dandole solo acceso a C:\Instaladores\whatsapp-workflow:
#        powershell -ExecutionPolicy Bypass -File .\instalar_web.ps1 `
#          -Cuenta ".\wa_serv" -Password "clave de la cuenta"
#      (o -Cuenta "NT AUTHORITY\NETWORK SERVICE" si prefieres cuenta integrada)
# ================================================================
param(
    [string]$Cuenta  = 'SYSTEM',
    [string]$Password = ''
)

$ErrorActionPreference = 'Continue'

$dir = 'C:\Instaladores\whatsapp-workflow'
$cmd      = Join-Path $dir 'startweb.cmd'
$taskName = 'WhatsAppWeb'

if (-not (Test-Path $cmd)) {
    Write-Host ''
    Write-Host "ERROR: No encuentro $cmd" -ForegroundColor Red
    Write-Host 'Comprueba que has descomprimido el zip y que la ruta es correcta.'
    exit 1
}

$cert = Join-Path $dir 'certs\server.crt'
$key  = Join-Path $dir 'certs\server.key'
$certPresent = (Test-Path $cert) -and (Test-Path $key)
if (-not $certPresent) {
    Write-Host ''
    Write-Host "AVISO: No se han encontrado los certificados TLS en:" -ForegroundColor Yellow
    Write-Host "  $cert"
    Write-Host "  $key"
    Write-Host 'El panel arrancara en modo HTTP. Para HTTPS, genera el cert con XCA y colocalos ahi.' -ForegroundColor Yellow
}

Write-Host ''
Write-Host "Creando la tarea programada (cuenta: $Cuenta)..."

schtasks /Query /TN "$taskName" *> $null
if ($LASTEXITCODE -eq 0) {
    schtasks /Delete /TN "$taskName" /F *> $null
}

if ($Cuenta -eq 'SYSTEM') {
    schtasks /Create /TN "$taskName" /SC ONSTART /TR "cmd /c `"$cmd`"" /RU SYSTEM /RL HIGHEST /F
} elseif ($Password) {
    schtasks /Create /TN "$taskName" /SC ONSTART /TR "cmd /c `"$cmd`"" /RU "$Cuenta" /RP "$Password" /F
} else {
    schtasks /Create /TN "$taskName" /SC ONSTART /TR "cmd /c `"$cmd`"" /RU "$Cuenta" /F
}
if ($LASTEXITCODE -ne 0) {
    Write-Host 'ERROR: fallo al crear la tarea.' -ForegroundColor Red
    Write-Host 'Recuerda: la cuenta debe existir y tener permisos sobre C:\Instaladores\whatsapp-workflow.'
    exit 1
}

schtasks /Run /TN "$taskName"

Write-Host ''
Write-Host 'Tarea creada y arrancada.' -ForegroundColor Green
Write-Host "Log: $dir\logs\web.log"
Write-Host ''
Write-Host 'Para ver el estado:' -ForegroundColor Cyan
Write-Host "  schtasks /Query /TN $taskName"
Write-Host "  Get-Content $dir\logs\web.log -Tail 15"
