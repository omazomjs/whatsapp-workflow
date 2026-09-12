# ================================================================
#  INSTALACION GESMENSAJERIA en 192.168.1.212\SQL2008
#  Te pedira la contrasena de sa por teclado (no se guarda en ningun
#  archivo). Ejecuta en PowerShell:  .\run_setup.ps1
# ================================================================
$ErrorActionPreference = 'Stop'

$Server = '192.168.1.212\SQL2008'
$User   = 'sa'
$DbDir  = Join-Path $PSScriptRoot 'sql'

Write-Host ''
Write-Host '==================================================' -ForegroundColor Cyan
Write-Host '  INSTALACION DE GESMENSAJERIA'                    -ForegroundColor Cyan
Write-Host "  Servidor: $Server"                               -ForegroundColor Cyan
Write-Host '==================================================' -ForegroundColor Cyan

$secure = Read-Host -AsSecureString "Contrasena de [$User]"
$bstr   = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
$env:SQLCMDPASSWORD = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
[System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)

try {
    # 1) Crear GesMensajeria + tablas + login/permisos del worker
    Write-Host ''
    Write-Host '>> Script 1: GesMensajeria (BD, tablas, usuario wa_bot)...' -ForegroundColor Yellow
    & sqlcmd -S $Server -U $User -i (Join-Path $DbDir 'setup_gesmensajeria.sql')
    if ($LASTEXITCODE -ne 0) { throw "Fallaron comandos del Script 1 (codigo $LASTEXITCODE)" }

    # 2) Permiso de SOLO LECTURA en la BD de negocio REFact
    Write-Host ''
    Write-Host '>> Script 2: acceso solo-lectura a REFact...' -ForegroundColor Yellow
    & sqlcmd -S $Server -U $User -d REFact -i (Join-Path $DbDir 'setup_source.sql')
    if ($LASTEXITCODE -ne 0) { throw "Fallaron comandos del Script 2 (codigo $LASTEXITCODE)" }

    Write-Host ''
    Write-Host 'INSTALACION COMPLETADA OK' -ForegroundColor Green
    Write-Host '  - BD GesMensajeria con WhatsAppOutbox y WhatsAppState'
    Write-Host '  - Login wa_bot: acceso total a GesMensajeria'
    Write-Host '  - Login wa_bot: solo lectura en REFact'
}
catch {
    Write-Host ''
    Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
finally {
    Remove-Item Env:SQLCMDPASSWORD -ErrorAction SilentlyContinue
}