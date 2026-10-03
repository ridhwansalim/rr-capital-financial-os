[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$SnapshotPath,
  [switch]$IncludeData,
  [switch]$VerifySampleCleanup,
  [string]$Container = 'rr-capital-restore-check',
  [string]$DockerExecutable = 'docker'
)

$ErrorActionPreference = 'Stop'
$RepositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$BootstrapPath = Join-Path $PSScriptRoot 'local_test_support.bootstrap.sql'
$SampleCleanupPath = Join-Path $PSScriptRoot 'fixtures\rr_capital_sample_cleanup.sql'
if ($VerifySampleCleanup -and -not $IncludeData) {
  throw 'The sample-cleanup rehearsal requires -IncludeData and a current protected fixture snapshot.'
}
$ResolvedSnapshot = (Resolve-Path -LiteralPath $SnapshotPath).Path
$SnapshotItem = Get-Item -LiteralPath $ResolvedSnapshot -Force
if (-not $SnapshotItem.PSIsContainer -or (($SnapshotItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0)) {
  throw 'Snapshot path must be a real directory, not a reparse point.'
}

$Verifier = Join-Path $PSScriptRoot 'Test-RR-Capital-Backup.ps1'
& $Verifier -SnapshotPath $ResolvedSnapshot

if ($IncludeData) {
  $DataPath = Join-Path $ResolvedSnapshot 'data.sql'
  $DataSchemas = @(
    Select-String -LiteralPath $DataPath -Pattern '^COPY\s+"?([A-Za-z_][A-Za-z0-9_]*)"?\.' -AllMatches |
      ForEach-Object { $_.Matches } |
      ForEach-Object { $_.Groups[1].Value } |
      Sort-Object -Unique
  )
  $AppSchemas = @('public', 'private')
  $ManagedSchemas = @($DataSchemas | Where-Object { $_ -notin $AppSchemas })
  if ($ManagedSchemas.Count -gt 0) {
    throw "Data restore requires managed schemas absent from the isolated bootstrap ($($ManagedSchemas -join ', ')); this snapshot is not app-schema-only."
  }
}

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
$ContainerData = "/tmp/$Database-data.sql"
$ContainerBootstrap = "/tmp/$Database-bootstrap.sql"
$ContainerSampleCleanup = "/tmp/$Database-sample-cleanup.sql"
$SchemaPath = Join-Path $ResolvedSnapshot 'schema.sql'
$DataPath = Join-Path $ResolvedSnapshot 'data.sql'
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
  if ($IncludeData) {
    Invoke-Docker -Arguments @('cp', $DataPath, "${Container}:$ContainerData") | Out-Null
    Invoke-Docker -Arguments @('exec', '-u', 'postgres', $Container, 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', $Database, '-f', $ContainerData) | Out-Null
  }

  if ($VerifySampleCleanup) {
    $OwnerId = '5bf09e85-e346-4c79-808f-29d8577d04ae'
    $SeedOwner = "INSERT INTO auth.users (id, email) VALUES ('$OwnerId', 'rr-sample-cleanup-rehearsal@example.invalid') ON CONFLICT (id) DO NOTHING;"
    Invoke-Docker -Arguments @('exec', '-u', 'postgres', $Container, 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', $Database, '-c', $SeedOwner) | Out-Null

    $BeforeSql = @'
SELECT json_build_object(
  'accounts', (SELECT count(*) FROM public.accounts WHERE owner_id = '5bf09e85-e346-4c79-808f-29d8577d04ae'),
  'categories', (SELECT count(*) FROM public.transaction_categories WHERE name LIKE '[RR SAMPLE]%'),
  'transactions', (SELECT count(*) FROM public.transactions WHERE description LIKE '[RR SAMPLE]%'),
  'non_sample_attached', (SELECT count(*) FROM public.transactions WHERE (from_account_id IN ('f37a0b61-7118-4bc2-a7f6-000000000011','f37a0b61-7118-4bc2-a7f6-000000000012','f37a0b61-7118-4bc2-a7f6-000000000013') OR to_account_id IN ('f37a0b61-7118-4bc2-a7f6-000000000011','f37a0b61-7118-4bc2-a7f6-000000000012','f37a0b61-7118-4bc2-a7f6-000000000013')) AND description NOT LIKE '[RR SAMPLE]%'),
  'profiles', (SELECT count(*) FROM public.profiles WHERE id = '5bf09e85-e346-4c79-808f-29d8577d04ae'),
  'feature_flags', (SELECT count(*) FROM public.user_feature_flags)
)::text;
'@
    $BeforeOutput = Invoke-Docker -Arguments @('exec', '-u', 'postgres', $Container, 'psql', '-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', $Database, '-c', $BeforeSql)
    $Before = (($BeforeOutput -join '').Trim()) | ConvertFrom-Json
    if ($Before.accounts -ne 3 -or $Before.categories -ne 10 -or $Before.transactions -ne 864 -or $Before.non_sample_attached -ne 0 -or $Before.profiles -ne 1 -or $Before.feature_flags -ne 6) {
      throw "Protected snapshot is not the expected three-year fixture; refusing cleanup rehearsal (accounts=$($Before.accounts), categories=$($Before.categories), tagged transactions=$($Before.transactions), untagged account transactions=$($Before.non_sample_attached), profiles=$($Before.profiles), flags=$($Before.feature_flags))."
    }

    Invoke-Docker -Arguments @('cp', $SampleCleanupPath, "${Container}:$ContainerSampleCleanup") | Out-Null
    Invoke-Docker -Arguments @('exec', '-u', 'postgres', $Container, 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', $Database, '-f', $ContainerSampleCleanup) | Out-Null
    $AfterSql = @'
SELECT json_build_object(
  'accounts', (SELECT count(*) FROM public.accounts WHERE owner_id = '5bf09e85-e346-4c79-808f-29d8577d04ae'),
  'sample_accounts', (SELECT count(*) FROM public.accounts WHERE name LIKE '[RR SAMPLE]%'),
  'sample_categories', (SELECT count(*) FROM public.transaction_categories WHERE name LIKE '[RR SAMPLE]%'),
  'sample_transactions', (SELECT count(*) FROM public.transactions WHERE description LIKE '[RR SAMPLE]%'),
  'profiles', (SELECT count(*) FROM public.profiles WHERE id = '5bf09e85-e346-4c79-808f-29d8577d04ae'),
  'profile_directory', (SELECT count(*) FROM public.profile_directory),
  'feature_flags', (SELECT count(*) FROM public.user_feature_flags)
)::text;
'@
    $AfterOutput = Invoke-Docker -Arguments @('exec', '-u', 'postgres', $Container, 'psql', '-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', $Database, '-c', $AfterSql)
    $After = (($AfterOutput -join '').Trim()) | ConvertFrom-Json
    if ($After.accounts -ne 0 -or $After.sample_accounts -ne 0 -or $After.sample_categories -ne 0 -or $After.sample_transactions -ne 0 -or $After.profiles -ne 1 -or $After.profile_directory -ne 1 -or $After.feature_flags -ne 6) {
      throw "Sample cleanup rehearsal postcondition failed (owner accounts=$($After.accounts), sample accounts=$($After.sample_accounts), categories=$($After.sample_categories), transactions=$($After.sample_transactions), profiles=$($After.profiles), directory=$($After.profile_directory), flags=$($After.feature_flags))."
    }
    Write-Output 'Sample cleanup rehearsal passed: sample accounts, categories and transactions removed; owner profile, directory and preferences preserved.'
  }

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
  $ExpectedRows = if ($IncludeData) { $null } else { 0 }
  if ($ParsedInventory.tables -le 0 -or $ParsedInventory.functions -le 0 -or ($null -ne $ExpectedRows -and $ParsedInventory.rows -ne $ExpectedRows)) {
    throw "Schema-only restore inventory check failed (tables=$($ParsedInventory.tables), functions=$($ParsedInventory.functions), rows=$($ParsedInventory.rows))."
  }

  $RestoreMode = if ($IncludeData) { 'schema and data' } else { 'schema-only' }
  Write-Output "$RestoreMode restore passed in isolated container: $($ParsedInventory.tables) tables, $($ParsedInventory.views) views, $($ParsedInventory.functions) functions, $($ParsedInventory.rows) aggregate rows."
}
finally {
  $CleanupErrors = [System.Collections.Generic.List[string]]::new()
  try {
    $TemporaryFiles = @($ContainerSchema, $ContainerBootstrap)
    if ($IncludeData) { $TemporaryFiles += $ContainerData }
    if ($VerifySampleCleanup) { $TemporaryFiles += $ContainerSampleCleanup }
    Invoke-Docker -Arguments (@('exec', $Container, 'rm', '-f') + $TemporaryFiles) | Out-Null
  } catch { $CleanupErrors.Add('Could not remove one or more temporary restore files.') }
  if ($CreatedDatabase) {
    try { Invoke-Docker -Arguments @('exec', '-u', 'postgres', $Container, 'dropdb', '--if-exists', '--force', $Database) | Out-Null }
    catch { $CleanupErrors.Add('Could not drop the scratch restore database.') }
  }
  if ($CleanupErrors.Count -gt 0) { throw ($CleanupErrors -join ' ') }
}

if ($CreatedDatabase) {
  $Remaining = Invoke-Docker -Arguments @('exec', '-u', 'postgres', $Container, 'psql', '-X', '-A', '-t', '-U', 'postgres', '-d', 'postgres', '-c', "SELECT count(*) FROM pg_database WHERE datname = '$Database'")
  if (($Remaining -join '').Trim() -ne '0') { throw 'Scratch database remains after cleanup.' }
}
$TemporaryFilePaths = @($ContainerSchema, $ContainerBootstrap)
if ($IncludeData) { $TemporaryFilePaths += $ContainerData }
if ($VerifySampleCleanup) { $TemporaryFilePaths += $ContainerSampleCleanup }
$TemporaryFilePredicates = @($TemporaryFilePaths | ForEach-Object { "test ! -e '$_'" })
$TemporaryFileCheck = Invoke-Docker -Arguments @('exec', $Container, 'sh', '-c', ($TemporaryFilePredicates -join ' && '))
if ($LASTEXITCODE -ne 0) { throw 'One or more temporary restore files remain in the isolated container.' }
Write-Output 'Scratch database and temporary SQL files were removed.'
