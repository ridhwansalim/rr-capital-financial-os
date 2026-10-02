param(
  [string]$ProjectRef = 'hnebvwfgsotrknxpgpmv',
  [switch]$Apply
)
$ErrorActionPreference = 'Stop'
$expectedProjectRef = 'hnebvwfgsotrknxpgpmv'
if ($ProjectRef -cne $expectedProjectRef) { throw 'This release bundle is pinned to RR Capital only.' }
$expectedPending = @(
  '20261002040958_place_pg_net_in_extensions_schema.sql'
)
$expectedHashes = @{
  '20261002040958_place_pg_net_in_extensions_schema.sql' = '357DDEC8CBE9BF52E418F82D5EE407B17E45B8A5D564A60903A042A42DFBD4A2'
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
  '20261002041000_revoke_legacy_p2p_debt_rpc.sql'
)
foreach ($name in $expectedPending) {
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
  $oldPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    $dryOutput = & npx --yes supabase@2.119.0 db push --dry-run --skip-vault --workdir $bundleRoot --project-ref $ProjectRef --output-format json 2>&1
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
  Write-Output 'PASS: the reviewed pg_net placement migration alone is selected; Perry and 410 excluded.'
  if (-not $Apply) {
    Write-Output 'DRY RUN ONLY: pass -Apply to execute the reviewed bundle.'
    return
  }
  try {
    $ErrorActionPreference = 'Continue'
    $applyOutput = & npx --yes supabase@2.119.0 db push --yes --skip-vault --workdir $bundleRoot --project-ref $ProjectRef 2>&1
    $applyCode = $LASTEXITCODE
  } finally { $ErrorActionPreference = $oldPreference }
  if ($applyCode -ne 0) { throw "Hosted migration apply failed (exit $applyCode); command output suppressed; stop and inspect hosted ledger." }
  Write-Output 'PASS: reviewed core migrations applied; Vault sync skipped; Perry and 410 excluded.'
}
finally {
  $resolvedTemp = [IO.Path]::GetFullPath($tempRoot).TrimEnd('\') + '\'
  $resolvedBundle = [IO.Path]::GetFullPath($bundleRoot)
  if (-not $resolvedBundle.StartsWith($resolvedTemp, [StringComparison]::OrdinalIgnoreCase)) { throw 'Refusing to remove a bundle outside the system temp directory.' }
  if (Test-Path -LiteralPath $resolvedBundle) { Remove-Item -LiteralPath $resolvedBundle -Recurse -Force }
}
