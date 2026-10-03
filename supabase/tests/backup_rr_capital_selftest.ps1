$ErrorActionPreference = 'Stop'

$BackupScript = Join-Path $PSScriptRoot '..\Backup-RR-Capital.ps1'
$VerifyScript = Join-Path $PSScriptRoot '..\Test-RR-Capital-Backup.ps1'
$PowerShellExe = (Get-Command 'powershell.exe').Source
$TempRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath()).TrimEnd('\')
$TestRoot = Join-Path $TempRoot ('rr capital backup selftest-' + [guid]::NewGuid().ToString('N'))
$BackupRoot = Join-Path $TestRoot 'snapshots'
$MockPowerShell = Join-Path $TestRoot 'mock-npx.ps1'
$MockAclPowerShell = Join-Path $TestRoot 'mock-acl-powershell.ps1'
$MockNpx = Join-Path $TestRoot 'npx.cmd'
$CallLog = Join-Path $TestRoot 'calls.txt'

function Assert-True {
  param([bool]$Condition, [string]$Message)
  if (-not $Condition) { throw $Message }
}

function Invoke-BackupVerifier {
  param([string]$Path, [string]$OutputPath)
  $errorPath = $OutputPath + '.stderr'
  $previousErrorActionPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  & $PowerShellExe -NoProfile -ExecutionPolicy Bypass -File $MockAclPowerShell $VerifyScript -SnapshotPath $Path 1> $OutputPath 2> $errorPath
  $exitCode = $LASTEXITCODE
  $ErrorActionPreference = $previousErrorActionPreference
  return $exitCode
}

try {
  [void](New-Item -ItemType Directory -Path $TestRoot)
  [void](New-Item -ItemType Directory -Path $BackupRoot)
  @'
$ErrorActionPreference = 'Stop'
$target = $args[0]
$targetArgs = @($args | Select-Object -Skip 1)
function Get-Acl {
  param([Parameter(Mandatory = $true)][string]$LiteralPath)
  $root = [System.IO.Path]::GetFullPath($env:RR_BACKUP_SELFTEST_ACL_ROOT).TrimEnd('\')
  $path = [System.IO.Path]::GetFullPath($LiteralPath).TrimEnd('\')
  $isRoot = [string]::Equals($root, $path, [System.StringComparison]::OrdinalIgnoreCase)
  $sids = @(
    [System.Security.Principal.WindowsIdentity]::GetCurrent().User,
    [System.Security.Principal.SecurityIdentifier]::new('S-1-5-18'),
    [System.Security.Principal.SecurityIdentifier]::new('S-1-5-32-544')
  )
  $rules = @($sids | ForEach-Object {
    [pscustomobject]@{
      AccessControlType = [System.Security.AccessControl.AccessControlType]::Allow
      FileSystemRights = [System.Security.AccessControl.FileSystemRights]::FullControl
      IdentityReference = $_
      IsInherited = -not $isRoot
    }
  })
  [pscustomobject]@{
    AreAccessRulesProtected = if ($isRoot -and $env:RR_BACKUP_SELFTEST_ACL_MODE -eq 'root-inherited') { $false } else { $isRoot }
    Owner = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
    Access = $rules
  }
}
function Start-Process {
  param(
    [string]$FilePath,
    [string]$ArgumentList,
    [string]$RedirectStandardOutput,
    [string]$RedirectStandardError,
    [switch]$Wait,
    [switch]$PassThru,
    [switch]$NoNewWindow
  )
  $parsedArgs = @([regex]::Matches($ArgumentList, '"([^"]*)"|(\S+)') | ForEach-Object {
    if ($_.Groups[1].Success) { $_.Groups[1].Value } else { $_.Groups[2].Value }
  })
  $stdout = @(& $FilePath @parsedArgs 2>&1 | ForEach-Object { [string]$_ })
  $code = $LASTEXITCODE
  if ($RedirectStandardOutput) { $stdout | Set-Content -LiteralPath $RedirectStandardOutput }
  if ($RedirectStandardError) { Set-Content -LiteralPath $RedirectStandardError -Value '' }
  [pscustomobject]@{ ExitCode = $code }
}
try {
  & $target @targetArgs
  exit 0
} catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 1
}
'@ | Set-Content -LiteralPath $MockAclPowerShell -Encoding UTF8
  @'
$all = @($args | ForEach-Object { [string]$_ })
Add-Content -LiteralPath $env:RR_BACKUP_SELFTEST_CALL_LOG -Value ($all -join '|')
if ($all -contains '--version') { [Console]::WriteLine('2.119.0'); exit 0 }
if ($all -contains '--dry-run') { exit 71 }
$fileIndex = [Array]::IndexOf($all, '--file')
if ($fileIndex -lt 0 -or $fileIndex + 1 -ge $all.Count) { exit 72 }
Set-Content -LiteralPath $all[$fileIndex + 1] -Value 'synthetic backup fixture' -Encoding ASCII
exit 0
'@ | Set-Content -LiteralPath $MockPowerShell -Encoding UTF8
  @'
@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0mock-npx.ps1" %*
exit /b %errorlevel%
'@ | Set-Content -LiteralPath $MockNpx -Encoding ASCII

  $env:RR_BACKUP_SELFTEST_CALL_LOG = $CallLog
  $env:RR_BACKUP_SELFTEST_ACL_ROOT = $BackupRoot
  $env:RR_BACKUP_SELFTEST_ACL_MODE = 'root-inherited'
  $previousErrorActionPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  $rejectedOutput = @(& $PowerShellExe -NoProfile -ExecutionPolicy Bypass -File $MockAclPowerShell $BackupScript -BackupRoot $BackupRoot -NpxExecutable $MockNpx 2>&1)
  $rejectedExitCode = $LASTEXITCODE
  $ErrorActionPreference = $previousErrorActionPreference
  Assert-True ($rejectedExitCode -ne 0) 'Backup runner accepted a root with inherited permissions.'
  $rejectedCalls = @(Get-Content -LiteralPath $CallLog)
  Assert-True ($rejectedCalls.Count -eq 1) 'Invalid ACL must be rejected before any dump command; only the CLI version check is allowed.'
  Assert-True (($rejectedCalls[0] -match '--version') -and ($rejectedCalls[0] -notmatch 'db\|dump')) 'Backup runner attempted a database dump before rejecting the invalid root ACL.'
  Remove-Item -LiteralPath $CallLog -Force

  $env:RR_BACKUP_SELFTEST_ACL_MODE = 'valid'
  $previousErrorActionPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  $output = @(& $PowerShellExe -NoProfile -ExecutionPolicy Bypass -File $MockAclPowerShell $BackupScript -BackupRoot $BackupRoot -NpxExecutable $MockNpx 2>&1)
  $exitCode = $LASTEXITCODE
  $ErrorActionPreference = $previousErrorActionPreference
  Assert-True ($exitCode -eq 0) "Backup runner self-test failed: $($output -join ' ')"
  Assert-True (($output -join ' ') -notmatch 'synthetic backup fixture') 'CLI fixture output leaked to the console.'

  $snapshots = @(Get-ChildItem -LiteralPath $BackupRoot -Directory)
  Assert-True ($snapshots.Count -eq 1) 'Expected exactly one isolated snapshot folder.'
  $snapshotPath = $snapshots[0].FullName
  $manifest = Get-Content -LiteralPath (Join-Path $snapshotPath 'manifest.json') -Raw | ConvertFrom-Json
  Assert-True ($manifest.status -eq 'complete') 'Manifest did not finish in complete state.'
  Assert-True ($manifest.project_ref -eq 'hnebvwfgsotrknxpgpmv') 'Manifest project reference is incorrect.'
  Assert-True ($manifest.files.Count -eq 3) 'Manifest must describe all three dump files.'
  Assert-True ((@($manifest.files | ForEach-Object { $_.name } | Sort-Object) -join ',') -eq 'data.sql,roles.sql,schema.sql') 'Manifest filenames do not match the required export set.'

  foreach ($file in $manifest.files) {
    $path = Join-Path $snapshotPath $file.name
    $actual = Get-FileHash -LiteralPath $path -Algorithm SHA256
    Assert-True ((Get-Item -LiteralPath $path).Length -eq $file.bytes) "Manifest size mismatch for $($file.name)."
    Assert-True ($actual.Hash -eq $file.sha256) "Manifest hash mismatch for $($file.name)."
  }

  $calls = Get-Content -LiteralPath $CallLog
  Assert-True ($calls.Count -eq 4) 'Expected a version check and three dump invocations.'
  Assert-True (($calls -join "`n") -notmatch '--dry-run') 'The runner must never invoke Supabase CLI dry-run.'
  Assert-True ((@($calls | Where-Object { $_ -notmatch '(^|\|)--offline(\||$)' }).Count) -eq 0) 'Pinned Supabase CLI calls must use the verified local npm cache without registry resolution.'
  Assert-True ((@($calls | Where-Object { $_ -match 'db\|dump\|--linked' }).Count) -eq 3) 'Expected three linked-project dump commands.'
  Assert-True (($calls -join "`n") -match '--role-only') 'Role-only export flag is missing.'
  Assert-True (($calls -join "`n") -match '--data-only') 'Data-only export flag is missing.'
  $dataDumpCalls = @($calls | Where-Object { $_ -match 'db\|dump\|--linked' -and $_ -match '--data-only' })
  Assert-True ($dataDumpCalls.Count -eq 1) 'Expected exactly one data-only export command.'
  Assert-True ($dataDumpCalls[0] -match '--schema\|public,private') 'Data export must be limited to application schemas.'
  Assert-True ($dataDumpCalls[0] -notmatch '(^|\|)(auth|storage)($|\.)') 'Managed Auth/Storage schemas must not be exported.'

  $verifiedExitCode = Invoke-BackupVerifier -Path $snapshotPath -OutputPath (Join-Path $TestRoot 'verify-valid.stdout')
  Assert-True ($verifiedExitCode -eq 0) "Backup verifier rejected the valid synthetic snapshot: $(Get-Content -LiteralPath (Join-Path $TestRoot 'verify-valid.stdout.stderr') -Raw)"

  $dataPath = Join-Path $snapshotPath 'data.sql'
  Add-Content -LiteralPath $dataPath -Value 'tampered' -Encoding ASCII
  $tamperedExitCode = Invoke-BackupVerifier -Path $snapshotPath -OutputPath (Join-Path $TestRoot 'verify-tampered.stdout')
  Assert-True ($tamperedExitCode -ne 0) 'Backup verifier accepted a modified export.'
  Set-Content -LiteralPath $dataPath -Value 'synthetic backup fixture' -Encoding ASCII
  $manifest = Get-Content -LiteralPath (Join-Path $snapshotPath 'manifest.json') -Raw | ConvertFrom-Json
  foreach ($file in $manifest.files) {
    $path = Join-Path $snapshotPath $file.name
    $fileInfo = Get-Item -LiteralPath $path
    $file.sha256 = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash
    $file.bytes = $fileInfo.Length
  }
  $manifest | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $snapshotPath 'manifest.json') -Encoding UTF8
  $manifest.status = 'in_progress'
  $manifest | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $snapshotPath 'manifest.json') -Encoding UTF8
  $incompleteExitCode = Invoke-BackupVerifier -Path $snapshotPath -OutputPath (Join-Path $TestRoot 'verify-incomplete.stdout')
  Assert-True ($incompleteExitCode -ne 0) 'Backup verifier accepted an in_progress snapshot.'

  Write-Output 'Backup runner and verifier self-test passed: pinned CLI, linked RR Capital guard, protected ACL, integrity detection, incomplete-snapshot rejection, and output suppression.'
}
finally {
  Remove-Item Env:\RR_BACKUP_SELFTEST_CALL_LOG -ErrorAction SilentlyContinue
  Remove-Item Env:\RR_BACKUP_SELFTEST_ACL_ROOT -ErrorAction SilentlyContinue
  Remove-Item Env:\RR_BACKUP_SELFTEST_ACL_MODE -ErrorAction SilentlyContinue
  $resolvedTestRoot = [System.IO.Path]::GetFullPath($TestRoot)
  $requiredPrefix = $TempRoot + [System.IO.Path]::DirectorySeparatorChar + 'rr capital backup selftest-'
  if ($resolvedTestRoot.StartsWith($requiredPrefix, [System.StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $resolvedTestRoot)) {
    Remove-Item -LiteralPath $resolvedTestRoot -Recurse -Force
  } else {
    throw 'Refusing to remove a self-test path outside its unique temporary directory.'
  }
}
