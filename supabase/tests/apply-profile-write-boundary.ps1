param(
  [string]$ProjectRef = 'hnebvwfgsotrknxpgpmv',
  [switch]$Apply
)

$ErrorActionPreference = 'Stop'
$expectedProjectRef = 'hnebvwfgsotrknxpgpmv'
if ($ProjectRef -cne $expectedProjectRef) {
  throw "This migration is approved for RR Capital only ($expectedProjectRef)."
}

$migrationHashes = @{
  '20261002055319_restrict_profile_update_columns.sql' = '71D79B67F50E41B4F1E09CD4FC10C71706426D78861FA54B6ABDEC9A6CB08F65'
  '20261002055400_restrict_category_mutation_columns.sql' = '0AE063F4B7C57C5BE0779BD632A8ADDA6300D216C24E6275246F96DA39E5A604'
}
$excludedMigrations = @(
  '20261002040100_perry_scoped_reader_role.sql',
  '20261002040200_readonly_personal_summary.sql',
  '20261002040600_perry_include_opening_balance.sql',
  '20261002041000_revoke_legacy_p2p_debt_rpc.sql',
  '20261002041011_retire_unsafe_perry_database_login.sql',
  '20261002065906_optional_modules_and_budgets.sql',
  '20261002071443_transaction_templates.sql',
  '20261002073827_savings_goals.sql',
  '20261002074322_shopping_lists.sql',
  '20261002075519_account_health_settings.sql',
  '20261002083715_financial_health_score_exclusions.sql'
)

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$sourceSupabase = Join-Path $repoRoot 'supabase'
foreach ($migrationName in $migrationHashes.Keys) {
  $migrationPath = Join-Path (Join-Path $sourceSupabase 'migrations') $migrationName
  if (-not (Test-Path -LiteralPath $migrationPath -PathType Leaf)) {
    throw "Reviewed write-boundary migration is missing: $migrationName"
  }
  $actualHash = (Get-FileHash -LiteralPath $migrationPath -Algorithm SHA256).Hash
  if ($actualHash -cne $migrationHashes[$migrationName]) {
    throw "Migration hash is not pinned or has changed for $migrationName. Actual SHA-256: $actualHash"
  }
}

$tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$bundleRoot = Join-Path $tempRoot ('rr-capital-profile-boundary-' + [guid]::NewGuid().ToString('N'))
$bundleSupabase = Join-Path $bundleRoot 'supabase'
$bundleMigrations = Join-Path $bundleSupabase 'migrations'
New-Item -ItemType Directory -Path $bundleMigrations -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $sourceSupabase 'config.toml') -Destination (Join-Path $bundleSupabase 'config.toml')

foreach ($file in (Get-ChildItem -LiteralPath (Join-Path $sourceSupabase 'migrations') -Filter '*.sql' | Sort-Object Name)) {
  if ($excludedMigrations -notcontains $file.Name) {
    Copy-Item -LiteralPath $file.FullName -Destination (Join-Path $bundleMigrations $file.Name)
  }
}
foreach ($excluded in $excludedMigrations) {
  if (Test-Path -LiteralPath (Join-Path $bundleMigrations $excluded)) {
    throw "Excluded migration unexpectedly entered bundle: $excluded"
  }
}

try {
  $npmCache = npm.cmd config get cache 2>$null
  $npxRoot = if ($npmCache) { Join-Path $npmCache '_npx' } else { $null }
  $cachedCli = $null
  if ($npxRoot -and (Test-Path -LiteralPath $npxRoot)) {
    foreach ($candidateRoot in (Get-ChildItem -LiteralPath $npxRoot -Directory)) {
      $candidatePackage = Join-Path $candidateRoot.FullName 'node_modules\supabase\package.json'
      $candidateShim = Join-Path $candidateRoot.FullName 'node_modules\.bin\supabase.cmd'
      if ((Test-Path -LiteralPath $candidatePackage) -and (Test-Path -LiteralPath $candidateShim)) {
        $candidateInfo = Get-Content -LiteralPath $candidatePackage -Raw | ConvertFrom-Json
        if ($candidateInfo.version -eq '2.119.0') { $cachedCli = $candidateShim; break }
      }
    }
  }
  if (-not $cachedCli) { throw 'Pinned Supabase CLI 2.119.0 is not cached; stopped before connecting.' }

  $previousPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    $dryOutput = & $cachedCli db push --dry-run --skip-vault --workdir $bundleRoot --project-ref $ProjectRef --output-format json 2>&1
    $dryExitCode = $LASTEXITCODE
  }
  finally { $ErrorActionPreference = $previousPreference }
  if ($dryExitCode -ne 0) {
    $safeDiagnostics = @($dryOutput | ForEach-Object {
      ([string]$_) `
        -replace '(?i)(token|password|secret|api[_-]?key)(\s*[:=]\s*)\S+', '$1$2[redacted]' `
        -replace '(?i)Bearer\s+\S+', 'Bearer [redacted]' `
        -replace 'https?://[^\s"''<>]+', '[url redacted]' `
        -replace 'eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+', '[jwt redacted]'
    } | Where-Object { $_ -match '(?i)error|failed|denied|unauthor|refused|invalid|timeout' } | Select-Object -First 4)
    $diagnosticText = if ($safeDiagnostics.Count) { $safeDiagnostics -join ' | ' } else { 'No safe diagnostic line was emitted.' }
    throw "Hosted dry-run failed (exit $dryExitCode): $diagnosticText"
  }

  $jsonLine = $dryOutput | Where-Object { $_ -is [string] -and $_.TrimStart().StartsWith('{') } | Select-Object -Last 1
  if (-not $jsonLine) { throw 'Supabase CLI returned no structured dry-run result; stopped.' }
  $result = $jsonLine | ConvertFrom-Json
  $pending = @($result.migrations | Sort-Object)
  $expectedPending = @($migrationHashes.Keys | Sort-Object)
  if (-not $result.dryRun -or ($pending -join "`n") -cne ($expectedPending -join "`n")) {
    throw "Unexpected pending selection; expected only $($expectedPending -join ', '), got: $($pending -join ', '). No migration was applied."
  }
  Write-Output "PASS dry-run selected only the reviewed profile/category write-boundary migrations for RR Capital; Vault sync skipped; Perry and deferred P2P migrations excluded."

  if (-not $Apply) {
    Write-Output 'DRY RUN ONLY. Pass -Apply after reviewing this exact migration to apply it.'
    return
  }

  try {
    $ErrorActionPreference = 'Continue'
    $applyOutput = & $cachedCli db push --yes --skip-vault --workdir $bundleRoot --project-ref $ProjectRef 2>&1
    $applyExitCode = $LASTEXITCODE
  }
  finally { $ErrorActionPreference = $previousPreference }
  if ($applyExitCode -ne 0) { throw "Migration apply failed (exit $applyExitCode); inspect the hosted migration ledger before retrying." }
  Write-Output "PASS applied the reviewed profile/category write-boundary migrations to RR Capital; Vault sync skipped."
}
finally {
  $resolvedTemp = [IO.Path]::GetFullPath($tempRoot).TrimEnd('\') + '\'
  $resolvedBundle = [IO.Path]::GetFullPath($bundleRoot)
  if (-not $resolvedBundle.StartsWith($resolvedTemp, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Refusing to remove temporary bundle outside the OS temp directory.'
  }
  if (Test-Path -LiteralPath $resolvedBundle) {
    Remove-Item -LiteralPath $resolvedBundle -Recurse -Force
  }
}
