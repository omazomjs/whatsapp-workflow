# ================================================================
#  Busca la tabla de ESTADOS que referencia dbo.Registro (REFact)
#  Te pedira la contrasena de sa por teclado (no se guarda).
#  Ejecuta:  powershell -ExecutionPolicy Bypass -File .\inspect_REFact_estado.ps1
# ================================================================
$ErrorActionPreference = 'Stop'

$Server = '192.168.1.212\SQL2008'
$User   = 'sa'
$DbDir  = Join-Path $PSScriptRoot 'sql'

Write-Host ''
Write-Host '==================================================' -ForegroundColor Cyan
Write-Host '  BUSCAR TABLA DE ESTADOS (REFact)'                 -ForegroundColor Cyan
Write-Host '==================================================' -ForegroundColor Cyan

$secure = Read-Host -AsSecureString "Contrasena de [$User]"
$bstr   = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
$env:SQLCMDPASSWORD = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
[System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)

try {
    & sqlcmd -S $Server -U $User -d REFact -W -s " | " -i (Join-Path $DbDir 'inspect_estado.sql')
    if ($LASTEXITCODE -ne 0) { throw "Fallaron comandos (codigo $LASTEXITCODE)" }
}
catch {
    Write-Host ''
    Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
finally {
    Remove-Item Env:SQLCMDPASSWORD -ErrorAction SilentlyContinue
  }