param(
  [string]$ProjectRef = 'hnebvwfgsotrknxpgpmv'
)

$ErrorActionPreference = 'Stop'
$expectedProjectRef = 'hnebvwfgsotrknxpgpmv'
if ($ProjectRef -ne $expectedProjectRef) {
  throw "This reviewed core release bundle targets RR Capital only ($expectedProjectRef)."
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$sourceSupabase = Join-Path $repoRoot 'supabase'
$tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$bundleRoot = Join-Path $tempRoot ('rr-capital-core-dryrun-' + [guid]::NewGuid().ToString('N'))
$bundleSupabase = Join-Path $bundleRoot 'supabase'
$bundleMigrations = Join-Path $bundleSupabase 'migrations'
$excludedPerryMigrations = @(
  '20261002040100_perry_scoped_reader_role.sql',
  '20261002040200_readonly_personal_summary.sql',
  '20261002040600_perry_include_opening_balance.sql'
)
$deferredPostDeployMigrations = @(
  '20261002041000_revoke_legacy_p2p_debt_rpc.sql'
)
$expectedPending = @(
  '20261002040000_revoke_authenticated_nonrow_privileges.sql',
  '20261002040300_ledger_retry_and_api_privilege_hardening.sql',
  '20261002040400_dated_account_opening_balances.sql',
  '20261002040500_installment_history_tracking.sql',
  '20261002040700_chronological_liquid_balance_validation.sql',
  '20261002040800_dated_settlement_payments.sql',
  '20261002040900_idempotent_p2p_debt_requests.sql'
)
$expectedHashes = @{
  '20261002040000_revoke_authenticated_nonrow_privileges.sql' = '856BCE61488012F511C5F75628AC1412FB11FF42098F26F49F9422B2F93E964F'
  '20261002040300_ledger_retry_and_api_privilege_hardening.sql' = '2DA283857916827D52B55AA7C2725BD030153C26C9D6BB9FE66596B3834C5915'
  '20261002040400_dated_account_opening_balances.sql' = '68981CC57F518E117A9CC400CDFDE518A01AB9DC11C817710FC3B2097A3E0F62'
  '20261002040500_installment_history_tracking.sql' = '3BAE7F02F745EA16BCE437FBEE4E2AD504EBCEFAE0F922B6DF85E9B24C7DDA2B'
  '20261002040700_chronological_liquid_balance_validation.sql' = '5162208615DA7C8D024F717851DD44C28541C3683B0A6B6EE65755FA8BED7933'
  '20261002040800_dated_settlement_payments.sql' = '82BAEEECEFCFEE348EFA522E6A3998EBB2E7E5123AC149F443689B1E9D1A2646'
  '20261002040900_idempotent_p2p_debt_requests.sql' = '31B66570E17070CC7BF3193F52D985FFF16DAC42EA55E945FDE375E1681BB8F6'
}

foreach ($name in $expectedPending) {
  $sourcePath = Join-Path (Join-Path $sourceSupabase 'migrations') $name
  if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) {
    throw "Reviewed core migration is missing: $name"
  }
  $actualHash = (Get-FileHash -LiteralPath $sourcePath -Algorithm SHA256).Hash
  if ($actualHash -cne $expectedHashes[$name]) {
    throw "Reviewed core migration hash changed for $name. Expected $($expectedHashes[$name]); got $actualHash. Review and update the release manifest deliberately."
  }
}

New-Item -ItemType Directory -Path $bundleMigrations -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $sourceSupabase 'config.toml') -Destination (Join-Path $bundleSupabase 'config.toml')
foreach ($file in (Get-ChildItem -LiteralPath (Join-Path $sourceSupabase 'migrations') -Filter '*.sql' | Sort-Object Name)) {
  if ($excludedPerryMigrations -notcontains $file.Name -and $deferredPostDeployMigrations -notcontains $file.Name) {
    Copy-Item -LiteralPath $file.FullName -Destination (Join-Path $bundleMigrations $file.Name)
  }
}

try {
  $cachedCli = $null
  $npmCache = npm config get cache 2>$null
  $npxRoot = if ($npmCache) { Join-Path $npmCache '_npx' } else { $null }
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

  $previousErrorActionPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    if ($cachedCli) {
      $output = & $cachedCli db push --dry-run --workdir $bundleRoot --project-ref $ProjectRef 2>&1
    } else {
      $output = & npx --yes supabase@2.119.0 db push --dry-run --workdir $bundleRoot --project-ref $ProjectRef 2>&1
    }
    $exitCode = $LASTEXITCODE
  }
  finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }
  if ($exitCode -ne 0) {
    throw "Supabase CLI dry-run failed (exit $exitCode):`n$($output -join "`n")"
  }

  $jsonLine = $output | Where-Object { $_ -is [string] -and $_.TrimStart().StartsWith('{') } | Select-Object -Last 1
  if (-not $jsonLine) {
    throw "Supabase CLI dry-run returned no structured migration result:`n$($output -join "`n")"
  }
  $result = $jsonLine | ConvertFrom-Json
  $actualPending = @($result.migrations | Sort-Object)
  $expectedSorted = @($expectedPending | Sort-Object)
  if (-not $result.dryRun -or ($actualPending -join "`n") -cne ($expectedSorted -join "`n")) {
    throw "Unexpected core release dry-run result. Expected only: $($expectedSorted -join ', '). Actual: $($actualPending -join ', ')"
  }

  Write-Output "PASS RR Capital core release dry-run: $($actualPending.Count) reviewed migrations; Perry migrations excluded; no hosted changes made."
  $output | Where-Object { $_ -is [string] -and $_ -match '^\s*[•]' }
}
finally {
  $resolvedTemp = [IO.Path]::GetFullPath($tempRoot)
  $resolvedBundle = [IO.Path]::GetFullPath($bundleRoot)
  if (-not $resolvedBundle.StartsWith($resolvedTemp, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Refusing to remove temporary migration bundle outside the OS temp directory.'
  }
  if (Test-Path -LiteralPath $resolvedBundle) {
    Remove-Item -LiteralPath $resolvedBundle -Recurse -Force
  }
}
