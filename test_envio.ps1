# ================================================================
#  MENSAJE DE PRUEBA: inserta un aviso en la cola para comprobar
#  que el worker lo envia al movil. Te pedira la contrasena de sa
#  por teclado (no se guarda).
#  Ejecuta:  powershell -ExecutionPolicy Bypass -File .\test_envio.ps1
# ================================================================
$ErrorActionPreference = 'Stop'

$Server = '192.168.1.212\SQL2008'
$User   = 'sa'
$DbDir  = Join-Path $PSScriptRoot 'sql'

Write-Host ''
Write-Host '==================================================' -ForegroundColor Cyan
Write-Host '  PRUEBA DE ENVIO WHATSAPP'                        -ForegroundColor Cyan
Write-Host '==================================================' -ForegroundColor Cyan

$secure = Read-Host -AsSecureString "Contrasena de [$User]"
$bstr   = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
$env:SQLCMDPASSWORD = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
[System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)

try {
    & sqlcmd -S $Server -U $User -d GesMensajeria -i (Join-Path $DbDir 'test_envio.sql')
    if ($LASTEXITCODE -ne 0) { throw "Fallo al insertar (codigo $LASTEXITCODE)" }
    Write-Host ''
    Write-Host 'Mensaje de prueba encolado.' -ForegroundColor Green
    Write-Host 'Espera unos 30-60s y revisa el movil 660 400 537.' -ForegroundColor Yellow
}
catch {
    Write-Host ''
    Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
finally {
    Remove-Item Env:SQLCMDPASSWORD -ErrorAction SilentlyContinue
  }