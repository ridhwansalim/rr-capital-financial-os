param(
  [string]$ProjectRef = 'hnebvwfgsotrknxpgpmv',
  [switch]$Apply
)
$ErrorActionPreference = 'Stop'
$expectedProjectRef = 'hnebvwfgsotrknxpgpmv'
if ($ProjectRef -cne $expectedProjectRef) { throw 'This release bundle is pinned to RR Capital only.' }
$expectedPending = @(
  # No pending release migrations after the Telegram RPC hardening is applied.
)
$expectedHashes = @{
  '20261002195439_match_obligation_on_ledger_retry.sql' = '2A202E37171F2FF09F88AD43018C7F705D87DEFDA1719505D015EF593C084FDD'
  '20261004114017_hide_telegram_status_definer_from_api.sql' = '3C48415C824FC671D8B6E7EBDD5872B62343866D31D51C590740E321B3C0B1DB'
  '20261004120000_enforce_chronological_credit_line_limits.sql' = 'FECB50CDE24C4F14D64E7E0CBC7C38198B4C81551EC4EC7F55BC299165B2C602'
  '20261004130000_protect_telegram_destination.sql' = 'B20F09961B143B5EA1FFA86D3B8FB33C83B39E1F09A4D54CA7C19596DC11A3AE'
  '20261004140000_explicit_api_deny_policies.sql' = '50F38AD38AA7CD845F29B450CD5BC2A1C1A6B3197C20E14D635F8D47CD4C3435'
  '20261004162756_group_split_expenses.sql' = '3F7658DE87398B0D24823901345CD763D8D2457E07DBD3627580FF6E3D610138'
  '20261004163119_group_split_metadata_hardening.sql' = 'C149AA8E0C04B4B8591AAAD5AC6C30C5E8A55FC47D07C6302C10169B78205204'
  '20261004160000_hide_telegram_status_definer_from_api.sql' = '3C48415C824FC671D8B6E7EBDD5872B62343866D31D51C590740E321B3C0B1DB'
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
foreach ($name in $expectedHashes.Keys) {
  $path = Join-Path (Join-Path $sourceSupabase 'migrations') $name
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Reviewed migration missing: $name" }
  $hash = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash
  if ($hash -cne $expectedHashes[$name]) { throw "Hash mismatch for reviewed migration: $name" }
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
  if (-not $result.dryRun) { throw 'Supabase did not return a dry-run result; apply stopped.' }
  if ($actual.Count -eq 0) {
    Write-Output 'PASS: all reviewed core migrations are already applied; no pending changes.'
    if ($Apply) { Write-Output 'No-op: no hosted changes made.' }
    else { Write-Output 'DRY RUN ONLY: no hosted changes made.' }
    return
  }
  if (($actual -join $nl) -cne ($expected -join $nl)) { throw 'Pending migration selection mismatch; apply stopped.' }
  Write-Output "PASS: reviewed core migration set matches the hosted pending set ($($actual.Count) migrations)."
  if (-not $Apply) {
    Write-Output 'DRY RUN ONLY: no hosted changes made.'
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
  Write-Output "PASS: reviewed RR Capital core release applied ($($expectedPending.Count) migrations); Vault sync skipped; Perry and legacy 410 excluded."
}
finally {
  $resolvedTemp = [IO.Path]::GetFullPath($tempRoot).TrimEnd('\') + '\'
  $resolvedBundle = [IO.Path]::GetFullPath($bundleRoot)
  if (-not $resolvedBundle.StartsWith($resolvedTemp, [StringComparison]::OrdinalIgnoreCase)) { throw 'Refusing to remove a bundle outside the system temp directory.' }
  if (Test-Path -LiteralPath $resolvedBundle) { Remove-Item -LiteralPath $resolvedBundle -Recurse -Force }
}
