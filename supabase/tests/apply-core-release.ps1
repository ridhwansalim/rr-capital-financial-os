param(
  [string]$ProjectRef = 'hnebvwfgsotrknxpgpmv',
  [switch]$Apply
)
$ErrorActionPreference = 'Stop'
$expectedProjectRef = 'hnebvwfgsotrknxpgpmv'
if ($ProjectRef -cne $expectedProjectRef) { throw 'This release bundle is pinned to RR Capital only.' }
$expectedPending = @(
  '20261004120000_enforce_chronological_credit_line_limits',
  '20261004130000_protect_telegram_destination'
)
$expectedHashes = @{
  '20261002195439_match_obligation_on_ledger_retry.sql' = '2A202E37171F2FF09F88AD43018C7F705D87DEFDA1719505D015EF593C084FDD'
  '20261004120000_enforce_chronological_credit_line_limits.sql' = '3808ED42933E37484ED382F5E734FC2AFCB9B581D8D87F2EE00030F6703F0217'
  '20261004130000_protect_telegram_destination.sql' = '12D8AAFF9FE9ACA569A110929B3E2E68003A1C2B48EBC78A8128A7087F49EE1C'
}
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$sourceSupabase = Join-Path $repoRoot 'supabase'
$tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$bundleRoot = Join-Path $tempRoot ('rr-capital-core-apply-' + [guid]::NewGuid().ToString('N'))
$bundleSupabase = Join-Path $bundleRoot 'supabase'
$bundleMigrations = Join-Path $bundleSupabase 'migrations'
$excluded = @(
  '20261002040100_perry_scoped_reader_role.sql',
  '20261002040200_readonly_personal_summary.sql',
  '20261002040600_perry_include_opening_balance.sql',
  '20261002041000_revoke_legacy_p2p_debt_rpc.sql',
  '20261002041011_retire_unsafe_perry_database_login.sql'
)
foreach ($name in $expectedPending) {
  $fileName = "$name.sql"
  $path = Join-Path (Join-Path $sourceSupabase 'migrations') $fileName
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Reviewed migration missing: $fileName" }
  $hash = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash
  if ($hash -cne $expectedHashes[$fileName]) { throw "Hash mismatch for reviewed migration: $fileName" }
}
New-Item -ItemType Directory -Path $bundleMigrations -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $sourceSupabase 'config.toml') -Destination (Join-Path $bundleSupabase 'config.toml')
foreach ($file in (Get-ChildItem -LiteralPath (Join-Path $sourceSupabase 'migrations') -Filter '*.sql' | Sort-Object Name)) {
  if ($excluded -notcontains $file.Name) { Copy-Item -LiteralPath $file.FullName -Destination (Join-Path $bundleMigrations $file.Name) }
}
foreach ($name in $excluded) {
  if (Test-Path -LiteralPath (Join-Path $bundleMigrations $name)) { throw "Excluded migration unexpectedly entered bundle: $name" }
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
  $oldPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    if ($cachedCli) {
      $dryOutput = & $cachedCli db push --dry-run --workdir $bundleRoot --project-ref $ProjectRef 2>&1
    } else {
      $dryOutput = & npx --yes supabase@2.119.0 db push --dry-run --workdir $bundleRoot --project-ref $ProjectRef 2>&1
    }
    $dryCode = $LASTEXITCODE
  } finally { $ErrorActionPreference = $oldPreference }
  if ($dryCode -ne 0) { throw "Hosted dry-run failed (exit $dryCode); command output suppressed." }
  $jsonLine = $dryOutput | Where-Object { $_ -is [string] -and $_.TrimStart().StartsWith('{') } | Select-Object -Last 1
  if (-not $jsonLine) { throw 'Hosted dry-run returned no structured migration result.' }
  $result = $jsonLine | ConvertFrom-Json
  $actual = @($result.migrations | Sort-Object)
  $expected = @($expectedPending | Sort-Object)
  $nl = [Environment]::NewLine
  if (-not $result.dryRun -or ($actual -join $nl) -cne ($expected -join $nl)) { throw 'Pending migration selection mismatch; apply stopped.' }
  Write-Output 'PASS: no core migration is pending; hosted ledger retry obligation-match fix is already recorded.'
  if (-not $Apply) {
    Write-Output 'DRY RUN ONLY: no hosted changes made.'
    return
  }
  if ($actual.Count -eq 0) {
    Write-Output 'No-op: the reviewed migration is already applied; no hosted changes made.'
    return
  }
  try {
    $ErrorActionPreference = 'Continue'
    if ($cachedCli) {
      $applyOutput = & $cachedCli db push --yes --skip-vault --workdir $bundleRoot --project-ref $ProjectRef 2>&1
    } else {
      $applyOutput = & npx --yes supabase@2.119.0 db push --yes --skip-vault --workdir $bundleRoot --project-ref $ProjectRef 2>&1
    }
    $applyCode = $LASTEXITCODE
  } finally { $ErrorActionPreference = $oldPreference }
  if ($applyCode -ne 0) { throw "Hosted migration apply failed (exit $applyCode); command output suppressed; stop and inspect hosted ledger." }
  Write-Output 'PASS: reviewed ledger retry fix applied; Vault sync skipped; Perry and legacy 410 excluded.'
}
finally {
  $resolvedTemp = [IO.Path]::GetFullPath($tempRoot).TrimEnd('\') + '\'
  $resolvedBundle = [IO.Path]::GetFullPath($bundleRoot)
  if (-not $resolvedBundle.StartsWith($resolvedTemp, [StringComparison]::OrdinalIgnoreCase)) { throw 'Refusing to remove a bundle outside the system temp directory.' }
  if (Test-Path -LiteralPath $resolvedBundle) { Remove-Item -LiteralPath $resolvedBundle -Recurse -Force }
}
