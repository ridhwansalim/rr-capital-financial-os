[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$SnapshotPath,
  [switch]$IncludeData,
  [switch]$ApplyReadinessMigrations,
  [switch]$VerifySampleCleanup,
  [string]$Container = 'rr-capital-restore-check',
  [string]$DockerExecutable = 'docker'
)

$ErrorActionPreference = 'Stop'
$RepositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$BootstrapPath = Join-Path $PSScriptRoot 'local_test_support.bootstrap.sql'
$SampleCleanupPath = Join-Path $PSScriptRoot 'fixtures\rr_capital_sample_cleanup.sql'
$ReadinessMigrations = @(
  (Join-Path $PSScriptRoot 'migrations\20261004120000_enforce_chronological_credit_line_limits.sql'),
  (Join-Path $PSScriptRoot 'migrations\20261004130000_protect_telegram_destination.sql'),
  (Join-Path $PSScriptRoot 'migrations\20261004140000_explicit_api_deny_policies.sql')
)
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
$ContainerReadinessMigrations = @($ReadinessMigrations | ForEach-Object { "/tmp/$Database-$([System.IO.Path]::GetFileName($_))" })
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

  if ($ApplyReadinessMigrations) {
    $BeforeMigrationSql = @'
SELECT jsonb_build_object(
  'credit_timeline', to_regprocedure('private.assert_credit_line_timeline(uuid,uuid,uuid,text,uuid,uuid,numeric,numeric,timestamptz)') IS NOT NULL,
  'telegram_status', to_regprocedure('public.get_telegram_link_status()') IS NOT NULL,
  'deny_policies', (SELECT count(*) FROM pg_policies WHERE policyname = 'api_roles_denied')
)::text;
'@
    $BeforeMigrationOutput = Invoke-Docker -Arguments @('exec', '-u', 'postgres', $Container, 'psql', '-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', $Database, '-c', $BeforeMigrationSql)
    $BeforeMigration = (($BeforeMigrationOutput -join '').Trim()) | ConvertFrom-Json
    if ($BeforeMigration.credit_timeline -or $BeforeMigration.telegram_status -or $BeforeMigration.deny_policies -gt 0) {
      throw 'Snapshot already contains one or more readiness migrations; refusing to replay a partial or already-upgraded snapshot.'
    }
    for ($index = 0; $index -lt $ReadinessMigrations.Count; $index++) {
      $MigrationPath = $ReadinessMigrations[$index]
      $ContainerMigration = $ContainerReadinessMigrations[$index]
      Invoke-Docker -Arguments @('cp', $MigrationPath, "${Container}:$ContainerMigration") | Out-Null
      Invoke-Docker -Arguments @('exec', '-u', 'postgres', $Container, 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', $Database, '-f', $ContainerMigration) | Out-Null
    }
    $AfterMigrationSql = @'
SELECT (jsonb_build_object(
  'credit_timeline', to_regprocedure('private.assert_credit_line_timeline(uuid,uuid,uuid,text,uuid,uuid,numeric,numeric,timestamptz)') IS NOT NULL,
  'credit_limit_history', to_regprocedure('private.validate_credit_line_limit_history()') IS NOT NULL,
  'account_type_history', to_regprocedure('private.prevent_account_type_change_with_history()') IS NOT NULL,
  'telegram_status', to_regprocedure('public.get_telegram_link_status()') IS NOT NULL,
  'telegram_destination_hidden', NOT has_column_privilege('authenticated', 'public.profiles', 'telegram_chat_id', 'select')
)
 || jsonb_build_object(
  'deny_policies', (SELECT count(*) FROM pg_policies WHERE policyname = 'api_roles_denied')
))::text;
'@
    $AfterMigrationOutput = Invoke-Docker -Arguments @('exec', '-u', 'postgres', $Container, 'psql', '-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', $Database, '-c', $AfterMigrationSql)
    $AfterMigration = (($AfterMigrationOutput -join '').Trim()) | ConvertFrom-Json
    if (-not $AfterMigration.credit_timeline -or -not $AfterMigration.credit_limit_history -or -not $AfterMigration.account_type_history -or -not $AfterMigration.telegram_status -or -not $AfterMigration.telegram_destination_hidden -or $AfterMigration.deny_policies -ne 12) {
      throw 'Readiness migration replay did not satisfy the expected credit-history, Telegram-privacy, and explicit API-deny catalog assertions.'
    }
  }

  if ($VerifySampleCleanup) {
    $OwnerId = '5bf09e85-e346-4c79-808f-29d8577d04ae'
    $SeedOwner = "INSERT INTO auth.users (id, email) VALUES ('$OwnerId', 'rr-sample-cleanup-rehearsal@example.invalid') ON CONFLICT (id) DO NOTHING;"
    Invoke-Docker -Arguments @('exec', '-u', 'postgres', $Container, 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', $Database, '-c', $SeedOwner) | Out-Null

    $BeforeSql = @'
SELECT json_build_object(
  'accounts', (SELECT count(*) FROM public.accounts WHERE id::text LIKE 'a7300000-0000-4000-8000-%' AND owner_id = '5bf09e85-e346-4c79-808f-29d8577d04ae'),
  'contacts', (SELECT count(*) FROM public.contacts WHERE id::text LIKE 'a7300000-0000-4000-8001-%' AND owner_id = '5bf09e85-e346-4c79-808f-29d8577d04ae'),
  'categories', (SELECT count(*) FROM public.transaction_categories WHERE id::text LIKE 'a7300000-0000-4000-8002-%' AND owner_id = '5bf09e85-e346-4c79-808f-29d8577d04ae'),
  'transactions', (SELECT count(*) FROM public.transactions WHERE id::text LIKE 'a7300000-0000-4000-8003-%' AND owner_id = '5bf09e85-e346-4c79-808f-29d8577d04ae' AND description LIKE '[RR SAMPLE]%'),
  'parties', (SELECT count(*) FROM public.parties WHERE id::text LIKE 'a7300000-0000-4000-8004-%'),
  'obligations', (SELECT count(*) FROM public.obligations WHERE id::text LIKE 'a7300000-0000-4000-8005-%' AND owner_id = '5bf09e85-e346-4c79-808f-29d8577d04ae'),
  'recurring_emis', (SELECT count(*) FROM public.recurring_emis WHERE id::text LIKE 'a7300000-0000-4000-8006-%' AND owner_id = '5bf09e85-e346-4c79-808f-29d8577d04ae'),
  'chittis', (SELECT count(*) FROM public.chittis WHERE id::text LIKE 'a7300000-0000-4000-8007-%' AND owner_id = '5bf09e85-e346-4c79-808f-29d8577d04ae'),
  'budget_envelopes', (SELECT count(*) FROM public.budget_envelopes WHERE id::text LIKE 'a7300000-0000-4000-8008-%' AND owner_id = '5bf09e85-e346-4c79-808f-29d8577d04ae'),
  'transaction_templates', (SELECT count(*) FROM public.transaction_templates WHERE id::text LIKE 'a7300000-0000-4000-8009-%' AND owner_id = '5bf09e85-e346-4c79-808f-29d8577d04ae'),
  'savings_goals', (SELECT count(*) FROM public.savings_goals WHERE id::text LIKE 'a7300000-0000-4000-8010-%' AND owner_id = '5bf09e85-e346-4c79-808f-29d8577d04ae'),
  'goal_contributions', (SELECT count(*) FROM public.savings_goal_contributions WHERE id::text LIKE 'a7300000-0000-4000-8011-%' AND owner_id = '5bf09e85-e346-4c79-808f-29d8577d04ae'),
  'shopping_lists', (SELECT count(*) FROM public.shopping_lists WHERE id::text LIKE 'a7300000-0000-4000-8012-%' AND owner_id = '5bf09e85-e346-4c79-808f-29d8577d04ae'),
  'shopping_items', (SELECT count(*) FROM public.shopping_list_items WHERE id::text LIKE 'a7300000-0000-4000-8013-%' AND owner_id = '5bf09e85-e346-4c79-808f-29d8577d04ae'),
  'installments', (SELECT count(*) FROM private.installment_occurrences WHERE owner_id = '5bf09e85-e346-4c79-808f-29d8577d04ae'),
  'non_sample_attached', (SELECT count(*) FROM public.transactions WHERE (from_account_id::text LIKE 'a7300000-0000-4000-8000-%' OR to_account_id::text LIKE 'a7300000-0000-4000-8000-%') AND NOT (id::text LIKE 'a7300000-0000-4000-8003-%' AND description LIKE '[RR SAMPLE]%')),
  'fixture_owner_mismatch', (SELECT
    (SELECT count(*) FROM public.accounts WHERE id::text LIKE 'a7300000-0000-4000-8000-%' AND owner_id <> '5bf09e85-e346-4c79-808f-29d8577d04ae') +
    (SELECT count(*) FROM public.contacts WHERE id::text LIKE 'a7300000-0000-4000-8001-%' AND owner_id <> '5bf09e85-e346-4c79-808f-29d8577d04ae') +
    (SELECT count(*) FROM public.transaction_categories WHERE id::text LIKE 'a7300000-0000-4000-8002-%' AND owner_id <> '5bf09e85-e346-4c79-808f-29d8577d04ae') +
    (SELECT count(*) FROM public.transactions WHERE id::text LIKE 'a7300000-0000-4000-8003-%' AND owner_id <> '5bf09e85-e346-4c79-808f-29d8577d04ae') +
    (SELECT count(*) FROM public.obligations WHERE id::text LIKE 'a7300000-0000-4000-8005-%' AND owner_id <> '5bf09e85-e346-4c79-808f-29d8577d04ae') +
    (SELECT count(*) FROM public.recurring_emis WHERE id::text LIKE 'a7300000-0000-4000-8006-%' AND owner_id <> '5bf09e85-e346-4c79-808f-29d8577d04ae') +
    (SELECT count(*) FROM public.chittis WHERE id::text LIKE 'a7300000-0000-4000-8007-%' AND owner_id <> '5bf09e85-e346-4c79-808f-29d8577d04ae') +
    (SELECT count(*) FROM public.budget_envelopes WHERE id::text LIKE 'a7300000-0000-4000-8008-%' AND owner_id <> '5bf09e85-e346-4c79-808f-29d8577d04ae') +
    (SELECT count(*) FROM public.transaction_templates WHERE id::text LIKE 'a7300000-0000-4000-8009-%' AND owner_id <> '5bf09e85-e346-4c79-808f-29d8577d04ae') +
    (SELECT count(*) FROM public.savings_goals WHERE id::text LIKE 'a7300000-0000-4000-8010-%' AND owner_id <> '5bf09e85-e346-4c79-808f-29d8577d04ae') +
    (SELECT count(*) FROM public.savings_goal_contributions WHERE id::text LIKE 'a7300000-0000-4000-8011-%' AND owner_id <> '5bf09e85-e346-4c79-808f-29d8577d04ae') +
    (SELECT count(*) FROM public.shopping_lists WHERE id::text LIKE 'a7300000-0000-4000-8012-%' AND owner_id <> '5bf09e85-e346-4c79-808f-29d8577d04ae') +
    (SELECT count(*) FROM public.shopping_list_items WHERE id::text LIKE 'a7300000-0000-4000-8013-%' AND owner_id <> '5bf09e85-e346-4c79-808f-29d8577d04ae')),
  'profiles', (SELECT count(*) FROM public.profiles WHERE id = '5bf09e85-e346-4c79-808f-29d8577d04ae'),
  'feature_flags', (SELECT count(*) FROM public.user_feature_flags)
)::text;
'@
    $BeforeOutput = Invoke-Docker -Arguments @('exec', '-u', 'postgres', $Container, 'psql', '-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', $Database, '-c', $BeforeSql)
    $Before = (($BeforeOutput -join '').Trim()) | ConvertFrom-Json
    $ExpectedFixture = @{ accounts = 10; contacts = 12; categories = 12; transactions = 480; parties = 10; obligations = 12; recurring_emis = 12; chittis = 12; budget_envelopes = 12; transaction_templates = 15; savings_goals = 12; goal_contributions = 36; shopping_lists = 12; shopping_items = 48; installments = 300 }
    $UnexpectedFixture = @($ExpectedFixture.Keys | Where-Object { [int]$Before.$_ -ne $ExpectedFixture[$_] })
    if ($UnexpectedFixture.Count -gt 0 -or $Before.non_sample_attached -ne 0 -or $Before.fixture_owner_mismatch -ne 0 -or $Before.profiles -ne 1 -or $Before.feature_flags -ne 6) {
      $FixtureSummary = ($ExpectedFixture.Keys | ForEach-Object { "$_=$($Before.$_) (expected $($ExpectedFixture[$_]))" }) -join ', '
      throw "Protected snapshot is not the expected isolated fixture; refusing cleanup rehearsal ($FixtureSummary, unrecognized attached activity=$($Before.non_sample_attached), owner mismatches=$($Before.fixture_owner_mismatch), profiles=$($Before.profiles), flags=$($Before.feature_flags))."
    }

    Invoke-Docker -Arguments @('cp', $SampleCleanupPath, "${Container}:$ContainerSampleCleanup") | Out-Null
    Invoke-Docker -Arguments @('exec', '-u', 'postgres', $Container, 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', $Database, '-f', $ContainerSampleCleanup) | Out-Null
    $AfterSql = @'
SELECT json_build_object(
  'accounts', (SELECT count(*) FROM public.accounts WHERE owner_id = '5bf09e85-e346-4c79-808f-29d8577d04ae'),
  'sample_accounts', (SELECT count(*) FROM public.accounts WHERE name LIKE '[RR SAMPLE]%'),
  'sample_categories', (SELECT count(*) FROM public.transaction_categories WHERE name LIKE '[RR SAMPLE]%'),
  'sample_transactions', (SELECT count(*) FROM public.transactions WHERE description LIKE '[RR SAMPLE]%'),
  'contacts', (SELECT count(*) FROM public.contacts WHERE id::text LIKE 'a7300000-0000-4000-8001-%'),
  'parties', (SELECT count(*) FROM public.parties WHERE id::text LIKE 'a7300000-0000-4000-8004-%'),
  'obligations', (SELECT count(*) FROM public.obligations WHERE id::text LIKE 'a7300000-0000-4000-8005-%'),
  'recurring_emis', (SELECT count(*) FROM public.recurring_emis WHERE id::text LIKE 'a7300000-0000-4000-8006-%'),
  'chittis', (SELECT count(*) FROM public.chittis WHERE id::text LIKE 'a7300000-0000-4000-8007-%'),
  'budget_envelopes', (SELECT count(*) FROM public.budget_envelopes WHERE id::text LIKE 'a7300000-0000-4000-8008-%'),
  'transaction_templates', (SELECT count(*) FROM public.transaction_templates WHERE id::text LIKE 'a7300000-0000-4000-8009-%'),
  'savings_goals', (SELECT count(*) FROM public.savings_goals WHERE id::text LIKE 'a7300000-0000-4000-8010-%'),
  'goal_contributions', (SELECT count(*) FROM public.savings_goal_contributions WHERE id::text LIKE 'a7300000-0000-4000-8011-%'),
  'shopping_lists', (SELECT count(*) FROM public.shopping_lists WHERE id::text LIKE 'a7300000-0000-4000-8012-%'),
  'shopping_items', (SELECT count(*) FROM public.shopping_list_items WHERE id::text LIKE 'a7300000-0000-4000-8013-%'),
  'installments', (SELECT count(*) FROM private.installment_occurrences WHERE owner_id = '5bf09e85-e346-4c79-808f-29d8577d04ae'),
  'profiles', (SELECT count(*) FROM public.profiles WHERE id = '5bf09e85-e346-4c79-808f-29d8577d04ae'),
  'profile_directory', (SELECT count(*) FROM public.profile_directory),
  'feature_flags', (SELECT count(*) FROM public.user_feature_flags)
)::text;
'@
    $AfterOutput = Invoke-Docker -Arguments @('exec', '-u', 'postgres', $Container, 'psql', '-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', $Database, '-c', $AfterSql)
    $After = (($AfterOutput -join '').Trim()) | ConvertFrom-Json
    $RemainingFixture = @('accounts','sample_accounts','sample_categories','sample_transactions','contacts','parties','obligations','recurring_emis','chittis','budget_envelopes','transaction_templates','savings_goals','goal_contributions','shopping_lists','shopping_items','installments' | Where-Object { [int]$After.$_ -ne 0 })
    if ($RemainingFixture.Count -gt 0 -or $After.profiles -ne 1 -or $After.profile_directory -ne 1 -or $After.feature_flags -ne 6) {
      throw "Sample cleanup rehearsal postcondition failed (remaining fixture tables: $($RemainingFixture -join ', '); profiles=$($After.profiles), directory=$($After.profile_directory), flags=$($After.feature_flags))."
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
    if ($ApplyReadinessMigrations) { $TemporaryFiles += $ContainerReadinessMigrations }
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
if ($ApplyReadinessMigrations) { $TemporaryFilePaths += $ContainerReadinessMigrations }
if ($VerifySampleCleanup) { $TemporaryFilePaths += $ContainerSampleCleanup }
$TemporaryFilePredicates = @($TemporaryFilePaths | ForEach-Object { "test ! -e '$_'" })
$TemporaryFileCheck = Invoke-Docker -Arguments @('exec', $Container, 'sh', '-c', ($TemporaryFilePredicates -join ' && '))
if ($LASTEXITCODE -ne 0) { throw 'One or more temporary restore files remain in the isolated container.' }
Write-Output 'Scratch database and temporary SQL files were removed.'
