param(
  [string]$ProjectRef = 'hnebvwfgsotrknxpgpmv',
  [switch]$Apply
)

$ErrorActionPreference = 'Stop'
$expectedProjectRef = 'hnebvwfgsotrknxpgpmv'
if ($ProjectRef -cne $expectedProjectRef) {
  throw "This release is approved for RR Capital only ($expectedProjectRef)."
}

$migrationHashes = [ordered]@{
  '20261002055319_restrict_profile_update_columns.sql' = '71D79B67F50E41B4F1E09CD4FC10C71706426D78861FA54B6ABDEC9A6CB08F65'
  '20261002055400_restrict_category_mutation_columns.sql' = '0AE063F4B7C57C5BE0779BD632A8ADDA6300D216C24E6275246F96DA39E5A604'
  '20261002065906_optional_modules_and_budgets.sql' = '944CCE209BFBD03D66D3A19959C760C9927D74B9796CB869FC65CD7FDFAC92E2'
  '20261002071443_transaction_templates.sql' = 'CB629E27344B6B1109D24C814ED79EBF75645862CF598E74A5AE80D9EAECA5C0'
  '20261002073827_savings_goals.sql' = 'CB3AE25F683DF9AD2F4EAAA22873EEF7ABE405104355E2B578566438B89F0969'
  '20261002074322_shopping_lists.sql' = 'ED5891602511E71522338B7F8CA9E8208E84FDA923C120A4931CBFDDC2B738CF'
  '20261002075519_account_health_settings.sql' = '1F0790343A41FA669BAC143B01C96ED6069F823E365A90E589300851485CB0B6'
  '20261002083715_financial_health_score_exclusions.sql' = '3A80350AF797021893D8F6FB13ADF37D59249930F015712D178B5E9D5F98280E'
}
$excludedMigrations = @(
  '20261002040100_perry_scoped_reader_role.sql',
  '20261002040200_readonly_personal_summary.sql',
  '20261002040600_perry_include_opening_balance.sql',
  '20261002041000_revoke_legacy_p2p_debt_rpc.sql',
  '20261002041011_retire_unsafe_perry_database_login.sql'
)

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$sourceSupabase = Join-Path $repoRoot 'supabase'
foreach ($migrationName in $migrationHashes.Keys) {
  $migrationPath = Join-Path (Join-Path $sourceSupabase 'migrations') $migrationName
  if (-not (Test-Path -LiteralPath $migrationPath -PathType Leaf)) {
    throw "Approved release migration is missing: $migrationName"
  }
  $actualHash = (Get-FileHash -LiteralPath $migrationPath -Algorithm SHA256).Hash
  if ($actualHash -cne $migrationHashes[$migrationName]) {
    throw "Approved migration hash changed for $migrationName. Actual SHA-256: $actualHash"
  }
}

$tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$bundleRoot = Join-Path $tempRoot ('rr-capital-approved-release-' + [guid]::NewGuid().ToString('N'))
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
    throw "Excluded migration entered release bundle: $excluded"
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
    throw "Unexpected pending migration selection; expected only the eight approved RR Capital migrations. Got: $($pending -join ', '). No migration was applied."
  }
  Write-Output 'PASS dry-run selected only the eight approved RR Capital security/XPENC migrations; Perry and duplicate cutover migrations were excluded; Vault sync was skipped.'

  if (-not $Apply) {
    Write-Output 'DRY RUN ONLY. Pass -Apply to apply this exact migration set after explicit owner approval.'
    return
  }

  try {
    $ErrorActionPreference = 'Continue'
    $applyOutput = & $cachedCli db push --yes --skip-vault --workdir $bundleRoot --project-ref $ProjectRef 2>&1
    $applyExitCode = $LASTEXITCODE
  }
  finally { $ErrorActionPreference = $previousPreference }
  if ($applyExitCode -ne 0) {
    throw "Migration apply failed (exit $applyExitCode); inspect the hosted migration ledger before retrying."
  }
  Write-Output 'PASS applied the eight approved security/XPENC migrations to RR Capital; Perry migrations and Vault sync were excluded.'
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
