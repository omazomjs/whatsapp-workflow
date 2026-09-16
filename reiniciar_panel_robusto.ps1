# Ejecutar EN INFOSERVER07 desde PowerShell como administrador.
$ErrorActionPreference = 'Stop'
$dir = 'C:\Instaladores\whatsapp-workflow'
$node = (Get-Command node.exe).Source
$server = Join-Path $dir 'web\server.js'
$log = Join-Path $dir 'logs\web.log'

if (-not (Test-Path -LiteralPath $server -PathType Leaf)) {
    throw "No encuentro $server"
}

New-Item -ItemType Directory -Path (Split-Path $log) -Force | Out-Null

# Evitar dos paneles simultaneos (HTTP viejo y HTTPS nuevo).
$pids = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
    Where-Object { $_.LocalPort -in 3000, 3443, 3444 } |
    Select-Object -ExpandProperty OwningProcess -Unique
foreach ($processId in $pids) {
    Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
}

Start-Sleep -Seconds 2
Start-Process -FilePath $node `
    -ArgumentList $server `
    -WorkingDirectory $dir `
    -WindowStyle Hidden `
    -RedirectStandardOutput $log `
    -RedirectStandardError (Join-Path $dir 'logs\web-error.log')

$respuesta = $null
$validacionAnterior = [System.Net.ServicePointManager]::ServerCertificateValidationCallback
try {
    # Compatible con Windows PowerShell 5.1, que no dispone del parametro
    # -SkipCertificateCheck de PowerShell 7.
    [System.Net.ServicePointManager]::ServerCertificateValidationCallback = { $true }
    for ($intento = 1; $intento -le 5; $intento++) {
        Start-Sleep -Seconds 3
        try {
            $respuesta = Invoke-RestMethod `
                -Uri 'https://localhost:3443/api/health' `
                -TimeoutSec 5 `
                -ErrorAction Stop
            break
        } catch {
            Write-Host "Intento HTTPS $intento/5 sin respuesta: $($_.Exception.Message)"
        }
    }
} finally {
    [System.Net.ServicePointManager]::ServerCertificateValidationCallback = $validacionAnterior
}

if (-not $respuesta.ok) {
    Get-Content -LiteralPath (Join-Path $dir 'logs\web-error.log') -Tail 20 -ErrorAction SilentlyContinue
    throw 'El panel no responde por HTTPS en el puerto 3443.'
}

Write-Host 'Panel HTTPS operativo: https://INFOSERVER07.maderas.local:3443' -ForegroundColor Green
