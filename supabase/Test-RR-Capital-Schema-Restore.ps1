[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$SnapshotPath,
  [string]$Container = 'rr-capital-restore-check',
  [string]$DockerExecutable = 'docker'
)

$ErrorActionPreference = 'Stop'
$RepositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$BootstrapPath = Join-Path $PSScriptRoot 'local_test_support.bootstrap.sql'
$ResolvedSnapshot = (Resolve-Path -LiteralPath $SnapshotPath).Path
$SnapshotItem = Get-Item -LiteralPath $ResolvedSnapshot -Force
if (-not $SnapshotItem.PSIsContainer -or (($SnapshotItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0)) {
  throw 'Snapshot path must be a real directory, not a reparse point.'
}

$Verifier = Join-Path $PSScriptRoot 'Test-RR-Capital-Backup.ps1'
& $Verifier -SnapshotPath $ResolvedSnapshot

$Docker = Get-Command $DockerExecutable -ErrorAction Stop
$InspectionJson = & $Docker.Source inspect $Container
if ($LASTEXITCODE -ne 0) { throw 'Could not inspect the isolated restore container.' }
$Inspection = ($InspectionJson -join "`n") | ConvertFrom-Json
$ContainerInfo = @($Inspection)[0]
if (@($Inspection).Count -ne 1 -or $ContainerInfo.State.Status -ne 'running' -or $ContainerInfo.State.Health.Status -ne 'healthy') {
  throw 'The isolated PostgreSQL restore container is not running and healthy.'
}
$PublishedBindings = $ContainerInfo.HostConfig.PortBindings
if (@($ContainerInfo.Mounts).Count -ne 0 -or ($null -ne $PublishedBindings -and @($PublishedBindings.PSObject.Properties).Count -ne 0)) {
  throw 'Restore container must have no host mounts or published ports.'
}

$Stamp = [DateTime]::UtcNow.ToString('yyyyMMddHHmmss') + (Get-Random -Minimum 1000 -Maximum 9999)
$Database = "rr_schema_restore_$Stamp"
$ContainerSchema = "/tmp/$Database-schema.sql"
$ContainerBootstrap = "/tmp/$Database-bootstrap.sql"
$SchemaPath = Join-Path $ResolvedSnapshot 'schema.sql'
$CreatedDatabase = $false

function Invoke-Docker {
  param([Parameter(Mandatory = $true)][string[]]$Arguments)
  $Output = & $Docker.Source @Arguments
  if ($LASTEXITCODE -ne 0) { throw "Docker command failed (exit $LASTEXITCODE): docker $($Arguments -join ' ')" }
  return $Output
}

try {
  Invoke-Docker -Arguments @('exec', '-u', 'postgres', $Container, 'createdb', '--template=template0', $Database) | Out-Null
  $CreatedDatabase = $true
  Invoke-Docker -Arguments @('cp', $SchemaPath, "${Container}:$ContainerSchema") | Out-Null
  Invoke-Docker -Arguments @('cp', $BootstrapPath, "${Container}:$ContainerBootstrap") | Out-Null
  Invoke-Docker -Arguments @('exec', '-u', 'postgres', $Container, 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', $Database, '-f', $ContainerBootstrap) | Out-Null
  Invoke-Docker -Arguments @('exec', '-u', 'postgres', $Container, 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', $Database, '-f', $ContainerSchema) | Out-Null

  $InventorySql = @'
WITH objects AS (
  SELECT count(*) FILTER (WHERE c.relkind IN ('r','p')) AS tables,
         count(*) FILTER (WHERE c.relkind = 'v') AS views
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname IN ('public','private')
), routines AS (
  SELECT count(*) AS functions FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname IN ('public','private')
), row_counts AS (
  SELECT coalesce(sum((xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', schemaname, tablename), false, true, '')))[1]::text::bigint),0) AS rows
  FROM pg_tables WHERE schemaname IN ('public','private')
)
SELECT json_build_object('tables', objects.tables, 'views', objects.views, 'functions', routines.functions, 'rows', row_counts.rows)::text
FROM objects, routines, row_counts;
'@
  $Inventory = Invoke-Docker -Arguments @('exec', '-u', 'postgres', $Container, 'psql', '-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', $Database, '-c', $InventorySql)
  $ParsedInventory = (($Inventory -join '').Trim()) | ConvertFrom-Json
  if ($ParsedInventory.tables -le 0 -or $ParsedInventory.functions -le 0 -or $ParsedInventory.rows -ne 0) {
    throw "Schema-only restore inventory check failed (tables=$($ParsedInventory.tables), functions=$($ParsedInventory.functions), rows=$($ParsedInventory.rows))."
  }

  Write-Output "Schema-only restore passed in isolated container: $($ParsedInventory.tables) tables, $($ParsedInventory.views) views, $($ParsedInventory.functions) functions, 0 rows."
}
finally {
  Invoke-Docker -Arguments @('exec', $Container, 'rm', '-f', $ContainerSchema, $ContainerBootstrap) | Out-Null
  if ($CreatedDatabase) {
    Invoke-Docker -Arguments @('exec', '-u', 'postgres', $Container, 'dropdb', '--if-exists', '--force', $Database) | Out-Null
  }
}

if ($CreatedDatabase) {
  $Remaining = Invoke-Docker -Arguments @('exec', '-u', 'postgres', $Container, 'psql', '-X', '-A', '-t', '-U', 'postgres', '-d', 'postgres', '-c', "SELECT count(*) FROM pg_database WHERE datname = '$Database'")
  if (($Remaining -join '').Trim() -ne '0') { throw 'Scratch database remains after cleanup.' }
}
Write-Output 'Scratch database and temporary SQL files were removed.'
