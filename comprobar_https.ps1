param(
    [string]$Directorio = $PSScriptRoot
)

$ErrorActionPreference = 'Stop'
$envFile = Join-Path $Directorio '.env'
$certDefault = Join-Path $Directorio 'certs\server.crt'
$keyDefault = Join-Path $Directorio 'certs\server.key'

function Leer-Env([string]$Nombre) {
    if (-not (Test-Path -LiteralPath $envFile)) { return '' }
    $linea = Get-Content -LiteralPath $envFile |
        Where-Object { $_ -match "^$([regex]::Escape($Nombre))=" } |
        Select-Object -Last 1
    if (-not $linea) { return '' }
    return ($linea -split '=', 2)[1].Trim()
}

function Resolver-Ruta([string]$Valor, [string]$Predeterminada) {
    if (-not $Valor) { return $Predeterminada }
    if ([IO.Path]::IsPathRooted($Valor)) { return $Valor }
    return Join-Path $Directorio $Valor
}

$cert = Resolver-Ruta (Leer-Env 'WEB_SSL_CERT') $certDefault
$key = Resolver-Ruta (Leer-Env 'WEB_SSL_KEY') $keyDefault
$puertoTexto = Leer-Env 'WEB_HTTPS_PORT'
$puerto = if ($puertoTexto) { [int]$puertoTexto } else { 3443 }

Write-Host "Proyecto:     $Directorio"
Write-Host "Certificado:  $cert"
Write-Host "Clave:        $key"
Write-Host "Puerto HTTPS: $puerto"

$ok = $true
if (-not (Test-Path -LiteralPath $cert -PathType Leaf)) {
    Write-Host 'FALTA el certificado TLS.' -ForegroundColor Red
    $ok = $false
}
if (-not (Test-Path -LiteralPath $key -PathType Leaf)) {
    Write-Host 'FALTA la clave privada TLS.' -ForegroundColor Red
    $ok = $false
}

if ($ok) {
    Write-Host 'Archivos TLS encontrados. El panel arrancara por HTTPS.' -ForegroundColor Green
    exit 0
}

Write-Host ''
Write-Host 'Coloca server.crt y server.key en la carpeta certs, o define sus rutas en .env:' -ForegroundColor Yellow
Write-Host 'WEB_SSL_CERT=certs\server.crt'
Write-Host 'WEB_SSL_KEY=certs\server.key'
Write-Host 'WEB_HTTPS_PORT=3443'
exit 1
