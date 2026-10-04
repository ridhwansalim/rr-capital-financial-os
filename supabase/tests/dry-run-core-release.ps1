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
$supersededTimestampMigrations = @(
  '20261002041000_revoke_legacy_p2p_debt_rpc.sql',
  '20261002041011_retire_unsafe_perry_database_login.sql'
)
$expectedPending = @(
  '20261004120000_enforce_chronological_credit_line_limits.sql',
  '20261004130000_protect_telegram_destination.sql',
  '20261004140000_explicit_api_deny_policies.sql'
)
$expectedHashes = @{
  '20261002103816_retire_unsafe_perry_database_login_after_live_ledger.sql' = '95528FF9472A0DEF4864553E859E035A4D208A60C7ACF62A96F52D35D9C22CB0'
  '20261002195439_match_obligation_on_ledger_retry.sql' = '2A202E37171F2FF09F88AD43018C7F705D87DEFDA1719505D015EF593C084FDD'
  '20261004120000_enforce_chronological_credit_line_limits.sql' = '3808ED42933E37484ED382F5E734FC2AFCB9B581D8D87F2EE00030F6703F0217'
  '20261004130000_protect_telegram_destination.sql' = '12D8AAFF9FE9ACA569A110929B3E2E68003A1C2B48EBC78A8128A7087F49EE1C'
  '20261004140000_explicit_api_deny_policies.sql' = '30DA9F8A5DD0FB03EC245D361074B7EDC1276B0DBC583B4C42FF433B606E60A2'
}

foreach ($name in $expectedHashes.Keys) {
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
  if ($excludedPerryMigrations -notcontains $file.Name -and $supersededTimestampMigrations -notcontains $file.Name) {
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

  Write-Output "PASS RR Capital core release dry-run: $($actualPending.Count) pending migrations; Perry migrations excluded; no hosted changes made."
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
