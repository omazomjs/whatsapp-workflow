# ================================================================
#  CAMBIA SOLO el password del panel web (WEB_PASSWORD) en el .env
#  de la carpeta del proyecto. NO toca DB_PASSWORD ni el resto.
#  El password lo teclea el usuario (enmascarado); no se muestra
#  ni se guarda en ningun otro sitio.
#
#  Ejecutar en el servidor (o PC de trabajo) con permisos de
#  escritura sobre el .env:
#    powershell -ExecutionPolicy Bypass -File .\cambiar_password_panel.ps1
#
#  Despues reiniciar el panel:
#    schtasks /End /TN "WhatsAppWeb"
#    schtasks /Run /TN "WhatsAppWeb"
# ================================================================
$ErrorActionPreference = 'Stop'

$envPath = Join-Path $PSScriptRoot '.env'
if (-not (Test-Path $envPath)) {
    Write-Host 'ERROR: no hay .env en esta carpeta.' -ForegroundColor Red
    exit 1
}

function Leer-Secreto([string]$etiqueta) {
    $sec = Read-Host -Prompt $etiqueta -AsSecureString
    if ($null -eq $sec) { return '' }
    $bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
    try {
        return [System.Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
    } finally {
        [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    }
}

Write-Host ''
Write-Host 'Nuevo password del panel web (login del panel, claves WEB_PASSWORD):' -ForegroundColor Cyan
$p1 = Leer-Secreto '  Password nuevo       '
$p2 = Leer-Secreto '  Repite el password   '

if ($p1 -ne $p2) {
    Write-Host 'No coinciden. Nada cambiado.' -ForegroundColor Red
    exit 1
}
if ($p1.Length -lt 8) {
    Write-Host 'Minimo 8 caracteres. Nada cambiado.' -ForegroundColor Red
    exit 1
}

$encoding = New-Object System.Text.UTF8Encoding($true)
$texto = [System.IO.File]::ReadAllText($envPath, [System.Text.Encoding]::UTF8)
$nuevo = [regex]::Replace($texto, '(?m)^WEB_PASSWORD=.*$', { param($m) 'WEB_PASSWORD=' + $p1 })
if ($nuevo -eq $texto) {
    Write-Host 'No se encontro la linea WEB_PASSWORD en .env. Nada cambiado.' -ForegroundColor Red
    exit 1
}
[System.IO.File]::WriteAllText($envPath, $nuevo, $encoding)

$p1 = $null; $p2 = $null
[System.GC]::Collect(); [System.GC]::WaitForPendingFinalizers()

Write-Host ''
Write-Host 'Password del panel actualizado en ' + $envPath -ForegroundColor Green
Write-Host ''
Write-Host 'Reinicia el panel (en el servidor, como Administrador):' -ForegroundColor Cyan
Write-Host '  schtasks /End /TN "WhatsAppWeb"'
Write-Host '  schtasks /Run /TN "WhatsAppWeb"'
Write-Host ''
Write-Host 'Consejo: guarda el password en un gestor (KeePass) o en un lugar
bajo llave, no en notas sueltas.' -ForegroundColor DarkGray