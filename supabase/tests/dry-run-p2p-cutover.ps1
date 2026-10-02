param([string]$ProjectRef = 'hnebvwfgsotrknxpgpmv')

$ErrorActionPreference = 'Stop'
$expectedProjectRef = 'hnebvwfgsotrknxpgpmv'
if ($ProjectRef -ne $expectedProjectRef) { throw "This cutover targets RR Capital only ($expectedProjectRef)." }

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$sourceSupabase = Join-Path $repoRoot 'supabase'
$migrationName = '20261002044711_revoke_legacy_p2p_debt_rpc.sql'
$expectedHash = '7AC6D80295AB2A53E34650C8C5DB5973352F0F0DA9CC7303A44E46953183E74F'
$sourcePath = Join-Path (Join-Path $sourceSupabase 'migrations') $migrationName
if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) { throw "Migration is missing: $migrationName" }
$actualHash = (Get-FileHash -LiteralPath $sourcePath -Algorithm SHA256).Hash
if ($actualHash -cne $expectedHash) { throw "Reviewed cutover migration hash changed. Expected $expectedHash; got $actualHash." }

$tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$bundleRoot = Join-Path $tempRoot ('rr-capital-p2p-cutover-' + [guid]::NewGuid().ToString('N'))
$bundleSupabase = Join-Path $bundleRoot 'supabase'
$bundleMigrations = Join-Path $bundleSupabase 'migrations'
$deferredPerry = @(
  '20261002040100_perry_scoped_reader_role.sql',
  '20261002040200_readonly_personal_summary.sql',
  '20261002040600_perry_include_opening_balance.sql',
  '20261002041000_revoke_legacy_p2p_debt_rpc.sql',
  '20261002041011_retire_unsafe_perry_database_login.sql'
)
New-Item -ItemType Directory -Path $bundleMigrations -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $sourceSupabase 'config.toml') -Destination (Join-Path $bundleSupabase 'config.toml')
foreach ($file in (Get-ChildItem -LiteralPath (Join-Path $sourceSupabase 'migrations') -Filter '*.sql' | Sort-Object Name)) {
  if ($deferredPerry -notcontains $file.Name) {
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
      $output = & $cachedCli db push --dry-run --skip-vault --output-format json --workdir $bundleRoot --project-ref $ProjectRef 2>&1
    } else {
      $output = & npx --yes supabase@2.119.0 db push --dry-run --skip-vault --output-format json --workdir $bundleRoot --project-ref $ProjectRef 2>&1
    }
    $exitCode = $LASTEXITCODE
  } finally { $ErrorActionPreference = $previousErrorActionPreference }
  if ($exitCode -ne 0) { throw "Supabase CLI cutover dry-run failed (exit $exitCode):`n$($output -join "`n")" }
  $jsonLine = $output | Where-Object { $_ -is [string] -and $_.TrimStart().StartsWith('{') } | Select-Object -Last 1
  if (-not $jsonLine) { throw "Supabase CLI returned no structured result:`n$($output -join "`n")" }
  $result = $jsonLine | ConvertFrom-Json
  $actualPending = @($result.migrations | Sort-Object)
  if (-not $result.dryRun -or $actualPending -contains $migrationName) {
    throw "Hosted ledger does not recognize the applied P2P cutover source $migrationName; pending selection: $($actualPending -join ', ')."
  }
  Write-Output "PASS RR Capital P2P cutover source $migrationName matches the hosted ledger and is not pending. Other pending migrations: $($actualPending -join ', '). No hosted changes made."
}
finally {
  $resolvedTemp = [IO.Path]::GetFullPath($tempRoot)
  $resolvedBundle = [IO.Path]::GetFullPath($bundleRoot)
  if (-not $resolvedBundle.StartsWith($resolvedTemp, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Refusing to remove temporary migration bundle outside the OS temp directory.'
  }
  if (Test-Path -LiteralPath $resolvedBundle) { Remove-Item -LiteralPath $resolvedBundle -Recurse -Force }
}
