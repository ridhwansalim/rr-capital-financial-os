param(
  [string]$ContainerName = 'supabase_db_financial-os',
  [switch]$CoreOnly,
  [switch]$StagedThenPerry
)

if ($CoreOnly -and $StagedThenPerry) {
  throw 'Choose either -CoreOnly or -StagedThenPerry, not both.'
}

$ErrorActionPreference = 'Stop'
$databaseName = 'rr_clean_replay_' + [guid]::NewGuid().ToString('N')
$databaseCreated = $false
$perryRoleExistedBefore = $null
$databaseCleanupError = $null
$roleCleanupError = $null

function Invoke-LocalAdminSql {
  param(
    [string]$Sql,
    [string]$Description
  )

  $previousErrorActionPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    $output = & docker exec $ContainerName psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres -c $Sql 2>&1
    $exitCode = $LASTEXITCODE
  }
  finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }
  if ($exitCode -ne 0) {
    throw "$Description failed (psql exit $exitCode):`n$($output -join "`n")"
  }
  return $output
}

$roleCheck = & docker exec $ContainerName psql -X -At -v ON_ERROR_STOP=1 -U postgres -d postgres -c "SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'perry_reader')"
if ($LASTEXITCODE -ne 0) { throw "Local Supabase database container '$ContainerName' must be running and accept PostgreSQL connections; catalog check failed." }
$perryRoleExistedBefore = ($roleCheck -join '').Trim() -eq 't'

$bootstrapPath = Join-Path $PSScriptRoot '..\local_test_support.bootstrap.sql'
$migrationPath = Join-Path $PSScriptRoot '..\migrations'
$configPath = Join-Path $PSScriptRoot '..\config.toml'
$configText = Get-Content -LiteralPath $configPath -Raw
$apiSection = [regex]::Match($configText, '(?ms)^\[api\]\s*(.*?)(?=^\[|\z)').Groups[1].Value
$apiSchemas = [regex]::Match($apiSection, '(?m)^schemas\s*=\s*\[(?<value>[^\]]*)\]').Groups['value'].Value
if (-not $apiSchemas -or $apiSchemas -match '"net"') {
  throw 'The `net` schema must remain excluded from Supabase Data API schemas.'
}
Write-Output 'PASS `net` schema is not exposed by local Supabase Data API configuration'
$testFiles = Get-ChildItem -LiteralPath $PSScriptRoot -Filter '*.test.sql' | Sort-Object Name
$migrations = Get-ChildItem -LiteralPath $migrationPath -Filter '*.sql' | Sort-Object Name
$perryMigrationPattern = '^20261002040(1|2|6)\d{2}_'
$excludedMigrationPattern = "$perryMigrationPattern|^20261002041000_|^20261002041011_"
if ($CoreOnly) {
  # Perry's optional migrations/tests are deliberately absent from the normal
  # RR Capital release. Prove the financial schema replays alone.
  $migrations = @($migrations | Where-Object { $_.BaseName -notmatch $excludedMigrationPattern })
  $testFiles = @($testFiles | Where-Object {
    $_.Name -ne 'perry_summary_security.test.sql'
  })
} elseif ($StagedThenPerry) {
  $perryMigrations = @($migrations | Where-Object { $_.BaseName -match $perryMigrationPattern })
  $coreMigrations = @($migrations | Where-Object { $_.BaseName -notmatch $excludedMigrationPattern })
  # Simulate shipping core first, then using a deliberate include-all follow-up
  # to apply only Perry's still-pending historical versions.
  $migrations = @($coreMigrations) + @($perryMigrations)
}

function Invoke-LocalPsql {
  param(
    [string]$Database,
    [string]$Sql,
    [string]$Description
  )

  $previousErrorActionPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    $output = $Sql | & docker exec -i $ContainerName psql -X -v ON_ERROR_STOP=1 -U postgres -d $Database 2>&1
    $exitCode = $LASTEXITCODE
  }
  finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }
  if ($exitCode -ne 0) {
    throw "$Description failed (psql exit $exitCode):`n$($output -join "`n")"
  }
  return $output
}

try {
  Invoke-LocalAdminSql "CREATE DATABASE $databaseName" 'Create clean replay database' | Out-Null
  $databaseCreated = $true

  Invoke-LocalPsql $databaseName (Get-Content -LiteralPath $bootstrapPath -Raw) 'Load isolated Supabase test support' | Out-Null
  Invoke-LocalPsql $databaseName @'
CREATE SCHEMA supabase_migrations;
CREATE TABLE supabase_migrations.schema_migrations (
  version text PRIMARY KEY,
  statements text[],
  name text
);
'@ 'Create isolated migration ledger' | Out-Null

  $migrationCount = 0
  foreach ($file in $migrations) {
    if ($file.BaseName -notmatch '^(?<version>\d{14})_(?<name>.+)$') {
      throw "Migration filename does not start with a 14-digit version: $($file.Name)"
    }
    $version = $Matches.version
    $name = $Matches.name
    $migrationSql = Get-Content -LiteralPath $file.FullName -Raw
    $ledgerSql = "INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES ('$version','$name',ARRAY[]::text[]);"
    Invoke-LocalPsql $databaseName "BEGIN;`n$migrationSql`n$ledgerSql`nCOMMIT;" "Apply migration $($file.Name)" | Out-Null
    $migrationCount++
  }

  $catalogCheckPath = Join-Path $PSScriptRoot '..\snippets\core_release_catalog_check.sql'
  Invoke-LocalPsql $databaseName (Get-Content -LiteralPath $catalogCheckPath -Raw) 'Run read-only core-release catalog verification' | Out-Null
  Write-Output 'PASS read-only core-release catalog verification'

  if ($CoreOnly) {
    Invoke-LocalPsql $databaseName @'
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations
              WHERE version IN ('20261002040100','20261002040200','20261002040600','20261002041000','20261002041011'))
     OR to_regclass('private.perry_owner_config') IS NOT NULL
     OR to_regprocedure('private.personal_summary()') IS NOT NULL
     OR to_regprocedure('public.personal_summary()') IS NOT NULL THEN
    RAISE EXCEPTION 'Core-only release unexpectedly includes Perry migrations or summary objects';
  END IF;
END $$;
'@ 'Verify Perry role and summary are absent from core-only release' | Out-Null
  } elseif ($StagedThenPerry) {
    Invoke-LocalPsql $databaseName @'
DO $$ DECLARE perry_versions text[]; BEGIN
  SELECT array_agg(version ORDER BY version) INTO perry_versions
  FROM supabase_migrations.schema_migrations
  WHERE version IN ('20261002040100','20261002040200','20261002040600');
  IF perry_versions IS DISTINCT FROM ARRAY['20261002040100','20261002040200','20261002040600']::text[]
     OR EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations
                 WHERE version IN ('20261002041000','20261002041011')) THEN
    RAISE EXCEPTION 'Staged Perry replay must include only the three deferred Perry migrations and exclude superseded aliases';
  END IF;
END $$;
'@ 'Verify staged Perry migrations and exclude superseded aliases' | Out-Null
  }

  $assertionCount = 0
  foreach ($file in $testFiles) {
    # Supabase places extension functions on the local test search path. Make
    # that explicit so this runner behaves the same on a plain local database.
    $testSql = "SET search_path TO extensions, public;`n" + (Get-Content -LiteralPath $file.FullName -Raw)
    $output = Invoke-LocalPsql $databaseName $testSql "Run SQL test $($file.Name)"
    $notOk = @($output | Select-String -Pattern '^\s*not ok\s+\d+\s*-').Count
    $ok = @($output | Select-String -Pattern '^\s*ok\s+\d+\s*-').Count
    $planMatch = @($output | Select-String -Pattern '^\s*1\.\.\s*(\d+)\s*$' | Select-Object -Last 1)
    $planned = if ($planMatch.Count -eq 1) { [int]$planMatch[0].Matches[0].Groups[1].Value } else { -1 }
    if ($notOk -gt 0 -or $ok -eq 0 -or $planned -ne $ok) {
      throw "SQL test $($file.Name) reported plan $planned, $notOk failed and $ok passing assertions.`n$($output -join "`n")"
    }
    $assertionCount += $ok
    Write-Output "PASS $($file.Name): $ok assertions"
  }

  $profile = if ($CoreOnly) { 'core-only ' } elseif ($StagedThenPerry) { 'staged-then-Perry ' } else { '' }
  Write-Output "PASS ${profile}clean replay: $migrationCount migrations, $($testFiles.Count) SQL test files, $assertionCount pgTAP assertions"
}
finally {
  if ($databaseCreated) {
    try {
      Invoke-LocalAdminSql "DROP DATABASE IF EXISTS $databaseName" 'Drop clean replay database' | Out-Null
      Write-Output "Dropped scratch database $databaseName"
    }
    catch {
      $databaseCleanupError = $_
    }
  }
  if ($perryRoleExistedBefore -eq $false) {
    try {
      Invoke-LocalAdminSql 'DROP ROLE IF EXISTS perry_reader' 'Clean up role created only for the scratch replay' | Out-Null
    }
    catch {
      $roleCleanupError = $_
    }
  }
  if ($databaseCleanupError) {
    Write-Error "Scratch database cleanup failed: $databaseCleanupError" -ErrorAction Continue
  }
  if ($roleCleanupError) {
    Write-Error "Scratch role cleanup failed: $roleCleanupError" -ErrorAction Continue
  }
}
