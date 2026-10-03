[CmdletBinding()]
param(
  [string]$Container = 'rr-capital-restore-check',
  [string]$DockerExecutable = 'docker'
)

$ErrorActionPreference = 'Stop'
$Docker = Get-Command $DockerExecutable -ErrorAction Stop
$MigrationPath = Join-Path $PSScriptRoot '..\v2-migrations\20260930165649_secure_access_boundary.sql'
$FinancialWriteMigrationPath = Join-Path $PSScriptRoot '..\v2-migrations\20261003150516_disable_legacy_direct_financial_writes.sql'
$ProfileColumnsMigrationPath = Join-Path $PSScriptRoot '..\v2-migrations\20261003163938_restrict_legacy_profile_columns.sql'
$BootstrapPath = Join-Path $PSScriptRoot '..\local_test_support.bootstrap.sql'
$FixturePath = Join-Path $PSScriptRoot 'v2_security_boundary_fixture.sql'
foreach ($Path in @($MigrationPath, $FinancialWriteMigrationPath, $ProfileColumnsMigrationPath, $BootstrapPath, $FixturePath)) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "Required fixture file is missing: $Path" }
}

$InspectionJson = & $Docker.Source inspect $Container
if ($LASTEXITCODE -ne 0) { throw 'Could not inspect the isolated PostgreSQL fixture container.' }
$Inspection = ($InspectionJson -join "`n") | ConvertFrom-Json
if (@($Inspection).Count -ne 1 -or $Inspection[0].State.Status -ne 'running' -or $Inspection[0].State.Health.Status -ne 'healthy') {
  throw 'The isolated PostgreSQL fixture container is not running and healthy.'
}
if (@($Inspection[0].Mounts).Count -ne 0 -or ($null -ne $Inspection[0].HostConfig.PortBindings -and @($Inspection[0].HostConfig.PortBindings.PSObject.Properties).Count -ne 0)) {
  throw 'Fixture container must have no host mounts or published ports.'
}

$Stamp = [DateTime]::UtcNow.ToString('yyyyMMddHHmmss') + (Get-Random -Minimum 1000 -Maximum 9999)
$Database = "v2_boundary_fixture_$Stamp"
$ContainerBootstrap = "/tmp/$Database-bootstrap.sql"
$ContainerFixture = "/tmp/$Database-fixture.sql"
$ContainerMigration = "/tmp/$Database-migration.sql"
$ContainerFinancialWriteMigration = "/tmp/$Database-financial-write-migration.sql"
$ContainerProfileColumnsMigration = "/tmp/$Database-profile-columns-migration.sql"
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
  Invoke-Docker -Arguments @('cp', $BootstrapPath, "${Container}:$ContainerBootstrap") | Out-Null
  Invoke-Docker -Arguments @('cp', $FixturePath, "${Container}:$ContainerFixture") | Out-Null
  Invoke-Docker -Arguments @('cp', $MigrationPath, "${Container}:$ContainerMigration") | Out-Null
  Invoke-Docker -Arguments @('cp', $FinancialWriteMigrationPath, "${Container}:$ContainerFinancialWriteMigration") | Out-Null
  Invoke-Docker -Arguments @('cp', $ProfileColumnsMigrationPath, "${Container}:$ContainerProfileColumnsMigration") | Out-Null
  Invoke-Docker -Arguments @('exec', '-u', 'postgres', $Container, 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', $Database, '-f', $ContainerBootstrap) | Out-Null
  Invoke-Docker -Arguments @('exec', '-u', 'postgres', $Container, 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', $Database, '-f', $ContainerFixture) | Out-Null
  Invoke-Docker -Arguments @('exec', '-u', 'postgres', $Container, 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', $Database, '-f', $ContainerMigration) | Out-Null
  Invoke-Docker -Arguments @('exec', '-u', 'postgres', $Container, 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', $Database, '-f', $ContainerFinancialWriteMigration) | Out-Null
  Invoke-Docker -Arguments @('exec', '-u', 'postgres', $Container, 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', $Database, '-f', $ContainerProfileColumnsMigration) | Out-Null

  $Assertions = @'
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['profiles','obligation_payments','parties','transactions','obligations'] LOOP
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = format('public.%I',t)::regclass) THEN
      RAISE EXCEPTION 'RLS is disabled on public.%', t;
    END IF;
    IF has_table_privilege('anon', format('public.%I',t), 'SELECT') THEN
      RAISE EXCEPTION 'anon retains table SELECT on public.%', t;
    END IF;
  END LOOP;
  IF has_table_privilege('authenticated','public.obligation_payments','SELECT')
     OR has_table_privilege('authenticated','public.parties','SELECT') THEN
    RAISE EXCEPTION 'authenticated retains access to a restricted legacy table';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='profiles'
                 AND policyname='profiles_read_own' AND roles=ARRAY['authenticated']::name[]
                 AND qual LIKE '%auth.uid%')
     OR EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='profiles'
                AND cmd='SELECT' AND policyname <> 'profiles_read_own') THEN
    RAISE EXCEPTION 'profiles SELECT policy was not restricted to owner-only';
  END IF;
  IF has_function_privilege('anon','public.notify_telegram_on_transaction()','EXECUTE')
     OR has_function_privilege('authenticated','public.notify_telegram_on_transaction()','EXECUTE')
     OR has_function_privilege('anon','public.trigger_telegram_alert()','EXECUTE')
     OR has_function_privilege('authenticated','public.trigger_telegram_alert()','EXECUTE') THEN
    RAISE EXCEPTION 'legacy notification trigger function remains API-callable';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid='public.notify_telegram_on_transaction()'::regprocedure
                 AND p.prosrc LIKE '%RETURN NEW%'
                 AND array_to_string(p.proconfig, ',') LIKE '%search_path=public, pg_temp%')
     OR NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid='public.trigger_telegram_alert()'::regprocedure
                    AND p.prosrc LIKE '%RETURN NEW%'
                    AND array_to_string(p.proconfig, ',') LIKE '%search_path=public, pg_temp%') THEN
    RAISE EXCEPTION 'legacy notification trigger was not replaced with a fixed-path no-op';
  END IF;
  IF has_table_privilege('anon','public.transactions','SELECT')
     OR has_table_privilege('anon','public.obligations','SELECT')
     OR NOT has_table_privilege('authenticated','public.transactions','SELECT')
     OR NOT has_table_privilege('authenticated','public.obligations','SELECT')
     OR has_table_privilege('authenticated','public.transactions','INSERT')
     OR has_table_privilege('authenticated','public.transactions','UPDATE')
     OR has_table_privilege('authenticated','public.transactions','DELETE')
     OR has_table_privilege('authenticated','public.obligations','INSERT')
     OR has_table_privilege('authenticated','public.obligations','UPDATE')
     OR has_table_privilege('authenticated','public.obligations','DELETE') THEN
    RAISE EXCEPTION 'legacy direct transaction/debt writes or anonymous reads remain';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
             AND tablename IN ('transactions','obligations')
             AND cmd IN ('INSERT','UPDATE','DELETE','ALL')) THEN
    RAISE EXCEPTION 'legacy broad financial write policy remains';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
                 AND tablename='transactions' AND policyname='transactions_read_owner_or_participant'
                 AND cmd='SELECT')
     OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
                    AND tablename='obligations' AND policyname='obligations_read_owner_or_participant'
                    AND cmd='SELECT') THEN
    RAISE EXCEPTION 'owner/participant financial reads were not preserved';
  END IF;
  IF has_table_privilege('authenticated','public.profiles','SELECT')
     OR has_table_privilege('authenticated','public.profiles','UPDATE')
     OR NOT has_column_privilege('authenticated','public.profiles','full_name','SELECT')
     OR NOT has_column_privilege('authenticated','public.profiles','theme_mode','UPDATE')
     OR has_column_privilege('authenticated','public.profiles','ai_api_key','SELECT')
     OR has_column_privilege('authenticated','public.profiles','ai_api_key','UPDATE')
     OR has_column_privilege('authenticated','public.profiles','telegram_chat_id','SELECT')
     OR has_column_privilege('authenticated','public.profiles','telegram_chat_id','UPDATE')
     OR has_column_privilege('authenticated','public.profiles','id','UPDATE')
     OR has_column_privilege('authenticated','public.profiles','created_at','UPDATE') THEN
    RAISE EXCEPTION 'profile column privileges expose secrets or server-managed identity/routing fields';
  END IF;
END $$;
'@
  $AssertionsPath = Join-Path ([System.IO.Path]::GetTempPath()) ("$Database-assertions.sql")
  try {
    Set-Content -LiteralPath $AssertionsPath -Value $Assertions -Encoding UTF8
    $ContainerAssertions = "/tmp/$Database-assertions.sql"
    Invoke-Docker -Arguments @('cp', $AssertionsPath, "${Container}:$ContainerAssertions") | Out-Null
    Invoke-Docker -Arguments @('exec', '-u', 'postgres', $Container, 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', $Database, '-f', $ContainerAssertions) | Out-Null
  }
  finally {
    Remove-Item -LiteralPath $AssertionsPath -Force -ErrorAction SilentlyContinue
  }
  Write-Output 'PASS v2 containment, financial-write hardening, and profile column boundary: RLS, owner-scoped profile reads, private legacy tables, inert notification functions, participant reads, safe preference updates, and no direct financial writes or client access to plaintext AI credentials/Telegram routing.'
}
finally {
  $CleanupErrors = [System.Collections.Generic.List[string]]::new()
  try { Invoke-Docker -Arguments @('exec', $Container, 'rm', '-f', $ContainerBootstrap, $ContainerFixture, $ContainerMigration, $ContainerFinancialWriteMigration, $ContainerProfileColumnsMigration, "/tmp/$Database-assertions.sql") | Out-Null }
  catch { $CleanupErrors.Add('Could not remove one or more fixture SQL files.') }
  if ($CreatedDatabase) {
    try { Invoke-Docker -Arguments @('exec', '-u', 'postgres', $Container, 'dropdb', '--if-exists', '--force', $Database) | Out-Null }
    catch { $CleanupErrors.Add('Could not drop the disposable v2 fixture database.') }
  }
  if ($CleanupErrors.Count -gt 0) { throw ($CleanupErrors -join ' ') }
}

$Remaining = Invoke-Docker -Arguments @('exec', '-u', 'postgres', $Container, 'psql', '-X', '-A', '-t', '-U', 'postgres', '-d', 'postgres', '-c', "SELECT count(*) FROM pg_database WHERE datname = '$Database'")
if (($Remaining -join '').Trim() -ne '0') { throw 'Disposable v2 fixture database remains after cleanup.' }
$FilesRemain = Invoke-Docker -Arguments @('exec', $Container, 'sh', '-c', "test ! -e '$ContainerBootstrap' && test ! -e '$ContainerFixture' && test ! -e '$ContainerMigration' && test ! -e '$ContainerFinancialWriteMigration' && test ! -e '$ContainerProfileColumnsMigration' && test ! -e '/tmp/$Database-assertions.sql'")
if ($LASTEXITCODE -ne 0) { throw 'One or more disposable v2 fixture SQL files remain in the container.' }
Write-Output 'Scratch database and temporary SQL files were removed.'
