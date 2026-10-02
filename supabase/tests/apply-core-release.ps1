param(
  [string]$ProjectRef = 'hnebvwfgsotrknxpgpmv',
  [switch]$Apply
)
$ErrorActionPreference = 'Stop'
$expectedProjectRef = 'hnebvwfgsotrknxpgpmv'
if ($ProjectRef -cne $expectedProjectRef) { throw 'This release bundle is pinned to RR Capital only.' }
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
  Write-Output 'PASS: seven reviewed core migrations selected; Perry and 410 excluded.'
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
