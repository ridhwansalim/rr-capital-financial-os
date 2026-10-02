param([string]$ProjectRef='hnebvwfgsotrknxpgpmv',[switch]$Apply)
$ErrorActionPreference='Stop'
if($ProjectRef -cne 'hnebvwfgsotrknxpgpmv'){throw 'RR Capital project ref required.'}
$name='20261002040950_installment_history_private_rpc_boundary.sql'
$hashExpected='F3FD8D4EAF033214DE1578FE7CF6E1366E1188C66C0DE7F3D2FF61A1951CADD3'
$root=(Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$source=Join-Path $root ('supabase\migrations\'+$name)
if(-not(Test-Path -LiteralPath $source -PathType Leaf)){throw 'Reviewed hotfix migration missing.'}
$hash=(Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash
if($hash -cne $hashExpected){throw 'Hotfix migration hash mismatch.'}
$temp=[IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$bundle=Join-Path $temp ('rr-capital-installment-rpc-'+[guid]::NewGuid().ToString('N'))
$bundleSupabase=Join-Path $bundle 'supabase'
$migrations=Join-Path $bundleSupabase 'migrations'
$exclude=@(
 '20261002040100_perry_scoped_reader_role.sql',
 '20261002040200_readonly_personal_summary.sql',
 '20261002040600_perry_include_opening_balance.sql',
 '20261002041000_revoke_legacy_p2p_debt_rpc.sql'
)
New-Item -ItemType Directory -Path $migrations -Force|Out-Null
Copy-Item -LiteralPath (Join-Path $root 'supabase\config.toml') -Destination (Join-Path $bundleSupabase 'config.toml')
foreach($file in Get-ChildItem -LiteralPath (Join-Path $root 'supabase\migrations') -Filter '*.sql'|Sort-Object Name){
 if($exclude -notcontains $file.Name){Copy-Item -LiteralPath $file.FullName -Destination (Join-Path $migrations $file.Name)}
}
if(Test-Path -LiteralPath (Join-Path $migrations '20261002041000_revoke_legacy_p2p_debt_rpc.sql')){throw 'Deferred migration 410 entered hotfix bundle.'}
try{
 $pref=$ErrorActionPreference
 try{$ErrorActionPreference='Continue';$dry=& npx --yes supabase@2.119.0 db push --dry-run --skip-vault --workdir $bundle --project-ref $ProjectRef --output-format json 2>&1;$dryCode=$LASTEXITCODE}finally{$ErrorActionPreference=$pref}
 if($dryCode -ne 0){throw "Hosted dry-run failed (exit $dryCode); output suppressed."}
 $json=$dry|Where-Object{$_ -is [string] -and $_.TrimStart().StartsWith('{')}|Select-Object -Last 1
 if(-not $json){throw 'No structured dry-run result; stopped.'}
 $result=$json|ConvertFrom-Json
 $pending=@($result.migrations|Sort-Object)
 if(-not $result.dryRun -or ($pending -join ',') -cne $name){throw 'Pending selection is not exactly the installment RPC hotfix; stopped.'}
 'PASS: only installment RPC hotfix selected; Perry and 410 excluded.'
 if(-not $Apply){'DRY RUN ONLY: pass -Apply to apply this hotfix.';return}
 try{$ErrorActionPreference='Continue';$null=& npx --yes supabase@2.119.0 db push --yes --skip-vault --workdir $bundle --project-ref $ProjectRef 2>&1;$code=$LASTEXITCODE}finally{$ErrorActionPreference=$pref}
 if($code -ne 0){throw "Hotfix apply failed (exit $code); output suppressed; inspect hosted migration ledger."}
 'PASS: installment RPC boundary hotfix applied; Vault sync skipped.'
}finally{
 $resolvedTemp=[IO.Path]::GetFullPath($temp).TrimEnd('\')+'\'
 $resolved=[IO.Path]::GetFullPath($bundle)
 if(-not $resolved.StartsWith($resolvedTemp,[StringComparison]::OrdinalIgnoreCase)){throw 'Refusing cleanup outside temp directory.'}
 if(Test-Path -LiteralPath $resolved){Remove-Item -LiteralPath $resolved -Recurse -Force}
}
