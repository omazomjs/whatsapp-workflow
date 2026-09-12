# ================================================================
#  crea / actualiza el login SQL wa_bot de forma segura.
#  La clave se pide por teclado (enmascarada) y se envia en memoria
#  a SQL Server: no queda escrita en ningun archivo.
#
#  Hacer -> [clave nueva de wa_bot (x2)] -> [clave de sa]
#  Nota: se puede ejecutar desde este PC con la VPN levantada
#        (default: el servidor DB_SERVER del .env) o desde la oficina.
#
#  Permisos que otorga:
#    - GesMensajeria : db_owner (control total, SOLO esta BD)
#    - REFact        : db_datareader (solo lectura)
# ================================================================
param(
    [string]$Servidor = ''
)

Add-Type -AssemblyName System.Data

if (-not $Servidor) {
    $envPath = Join-Path $PSScriptRoot '..\.env'
    if (Test-Path -LiteralPath $envPath) {
        $l = Get-Content -LiteralPath $envPath | Where-Object { $_ -match '^DB_SERVER=' } | Select-Object -First 1
        if ($l) { $Servidor = ($l -split '=', 2)[1].Trim() }
    }
    if (-not $Servidor) { $Servidor = 'localhost' }
}

function Leer-Secreto([string]$etiqueta) {
    $sec = Read-Host "  $etiqueta" -AsSecureString
    return [System.Runtime.InteropServices.Marshal]::PtrToStringUni(
        [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
}

Write-Host ""
Write-Host "Servidor SQL  : $Servidor"
Write-Host "Login a crear : wa_bot (db_owner de GesMensajeria + lectura en REFact)"
Write-Host ""

$nueva = Leer-Secreto "Nueva clave de wa_bot     :"
$nueva2 = Leer-Secreto "Repite la clave de wa_bot  :"
if ($nueva -ne $nueva2) { Write-Host "ERROR: las dos claves no coinciden." -ForegroundColor Red; exit 1 }

$sa = Leer-Secreto "Clave de sa (o cuenta admin):"
Write-Host ""

$conn = New-Object System.Data.SqlClient.SqlConnection
$conn.ConnectionString = "Server=$Servidor;Database=master;User Id=sa;Password=$sa;"
$conn.Open()

function Ejecutar($con, [string]$sql) {
    $cmd = $con.CreateCommand()
    $cmd.CommandText = $sql
    $null = $cmd.ExecuteNonQuery()
}

try {
    $existe = $false
    $cmd = $conn.CreateCommand()
    $cmd.CommandText = "SELECT COUNT(*) FROM sys.server_principals WHERE name = N'wa_bot'"
    $existe = ([int]$cmd.ExecuteScalar()) -gt 0

    if ($existe) {
        Ejecutar $conn "ALTER LOGIN [wa_bot] WITH PASSWORD = N'$($nueva.Replace("'", "''"))'"
        Write-Host "  Login wa_bot actualizado (ALTER LOGIN)." -ForegroundColor Green
    } else {
        Ejecutar $conn "CREATE LOGIN [wa_bot] WITH PASSWORD = N'$($nueva.Replace("'", "''"))', CHECK_POLICY = ON"
        Write-Host "  Login wa_bot creado." -ForegroundColor Green
    }

    foreach ($db in @('GesMensajeria', 'REFact')) {
        $ok = $false
        $cmd = $conn.CreateCommand()
        $cmd.CommandText = "SELECT COUNT(*) FROM sys.databases WHERE name = @d"
        $p = $cmd.CreateParameter(); $p.ParameterName = '@d'; $p.Value = $db
        $cmd.Parameters.Add($p) | Out-Null
        $ok = ([int]$cmd.ExecuteScalar()) -gt 0
        if (-not $ok) {
            Write-Host "  AVISO: la base '$db' no existe; saltando sus permisos." -ForegroundColor Yellow
            continue
        }
        $c2 = New-Object System.Data.SqlClient.SqlConnection
        $c2.ConnectionString = "Server=$Servidor;Database=$db;User Id=sa;Password=$sa;"
        $c2.Open()
        try {
            $cmd = $c2.CreateCommand()
            $cmd.CommandText = "SELECT COUNT(*) FROM sys.database_principals WHERE name = N'wa_bot'"
            if (([int]$cmd.ExecuteScalar()) -eq 0) {
                Ejecutar $c2 "CREATE USER [wa_bot] FOR LOGIN [wa_bot]"
            }
            if ($db -eq 'GesMensajeria') {
                Ejecutar $c2 "EXEC sp_addrolemember N'db_owner', N'wa_bot'"
                Write-Host "  GesMensajeria -> db_owner  OK" -ForegroundColor Green
            } else {
                Ejecutar $c2 "EXEC sp_addrolemember N'db_datareader', N'wa_bot'"
                Write-Host "  REFact -> db_datareader  OK" -ForegroundColor Green
            }
        } finally {
            $c2.Close()
        }
    }

    Write-Host ""
    Write-Host "LISTO. Permisos aplicados." -ForegroundColor Green

    $envPath = Join-Path $PSScriptRoot '..\.env'
    if (Test-Path -LiteralPath $envPath) {
        $lineas = New-Object System.Collections.Generic.List[string]
        foreach ($lin in [System.IO.File]::ReadAllLines($envPath)) {
            if ($lin -match '^DB_PASSWORD=') { continue }
            $lineas.Add($lin)
        }
        $lineas.Add('DB_PASSWORD=' + $nueva)
        [System.IO.File]::WriteAllLines($envPath, $lineas)
        Write-Host "DB_PASSWORD sincronizada en .env (misma clave que en el servidor)." -ForegroundColor Green
    } else {
        Write-Host "AVISO: no encuentro .env; no he sincronizado la clave local." -ForegroundColor Yellow
    }
} finally {
    $conn.Close()
}