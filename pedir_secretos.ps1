# ================================================================
#  PIDE SECRETOS POR TECLADO (enmascarado) y los guarda en .env
#  Las contrasenas SOLO las teclea el usuario en su propia consola.
#  Este script NO muestra los valores en ningun sitio.
#  Ejecutar en la carpeta del proyecto:
#    powershell -ExecutionPolicy Bypass -File .\pedir_secretos.ps1
# ================================================================
$ErrorActionPreference = 'Stop'

$envPath = Join-Path $PSScriptRoot '.env'
if (-not (Test-Path $envPath)) {
    Write-Host ''
    Write-Host 'ERROR: no hay .env en la carpeta del proyecto.' -ForegroundColor Red
    Write-Host 'Copia primero .env.example a .env y vuelve a ejecutar.'
    exit 1
}

Write-Host ''
Write-Host 'Vas a teclear las contrasenas (no se mostraran por pantalla).' -ForegroundColor Cyan
Write-Host 'Si dejas una vacia, se guarda vacia (el worker/panel la pediran al arrancar).'

function Pedir-Secreto([string]$etiqueta) {
    $sec = Read-Host -Prompt $etiqueta -AsSecureString
    if ($null -eq $sec) { return '' }
    $bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
    try {
        return [System.Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
    } finally {
        [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    }
}

$dbPass   = Pedir-Secreto 'Password SQL de wa_bot (DB_PASSWORD)'
$webPass  = Pedir-Secreto 'Password del panel web (WEB_PASSWORD)'
$secret   = -join ((48..57) + (97..122) + (65..90) | Get-Random -Count 48 | ForEach-Object { [char]$_ })

# Reconstruye .env conservando el resto de claves y reemplazando las 3 de secretos
$lineas = New-Object System.Collections.Generic.List[string]
foreach ($lin in [System.IO.File]::ReadAllLines($envPath)) {
    if ($lin -match '^(DB_PASSWORD|WEB_PASSWORD|WEB_SESSION_SECRET)=') { continue }
    $lineas.Add($lin)
}
$lineas.Add('DB_PASSWORD=' + $dbPass)
$lineas.Add('WEB_PASSWORD=' + $webPass)
$lineas.Add('WEB_SESSION_SECRET=' + $secret)

[System.IO.File]::WriteAllLines($envPath, $lineas)

# Limpieza de memoria
$dbPass = $null; $webPass = $null; $secret = $null
[System.GC]::Collect(); [System.GC]::WaitForPendingFinalizers()

Write-Host ''
Write-Host 'Listo. Secretos actualizados en .env (gitignored, no se suben a git).' -ForegroundColor Green
Write-Host 'Compruebalo con:  git status' -ForegroundColor DarkGray