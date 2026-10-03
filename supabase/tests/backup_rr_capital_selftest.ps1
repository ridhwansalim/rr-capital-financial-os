$ErrorActionPreference = 'Stop'

$BackupScript = Join-Path $PSScriptRoot '..\Backup-RR-Capital.ps1'
$PowerShellExe = (Get-Command 'powershell.exe').Source
$TempRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath()).TrimEnd('\')
$TestRoot = Join-Path $TempRoot ('rr capital backup selftest-' + [guid]::NewGuid().ToString('N'))
$BackupRoot = Join-Path $TestRoot 'snapshots'
$MockPowerShell = Join-Path $TestRoot 'mock-npx.ps1'
$MockNpx = Join-Path $TestRoot 'npx.cmd'
$CallLog = Join-Path $TestRoot 'calls.txt'

function Assert-True {
  param([bool]$Condition, [string]$Message)
  if (-not $Condition) { throw $Message }
}

try {
  [void](New-Item -ItemType Directory -Path $TestRoot)
  [void](New-Item -ItemType Directory -Path $BackupRoot)
  $currentSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
  $testAcl = [System.Security.AccessControl.DirectorySecurity]::new()
  $testAcl.SetAccessRuleProtection($true, $false)
  $inheritance = [System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [System.Security.AccessControl.InheritanceFlags]::ObjectInherit
  foreach ($sid in @($currentSid, [System.Security.Principal.SecurityIdentifier]::new('S-1-5-18'), [System.Security.Principal.SecurityIdentifier]::new('S-1-5-32-544'))) {
    $rule = [System.Security.AccessControl.FileSystemAccessRule]::new($sid, [System.Security.AccessControl.FileSystemRights]::FullControl, $inheritance, [System.Security.AccessControl.PropagationFlags]::None, [System.Security.AccessControl.AccessControlType]::Allow)
    [void]$testAcl.AddAccessRule($rule)
  }
  Set-Acl -LiteralPath $BackupRoot -AclObject $testAcl
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
  $output = @(& $PowerShellExe -NoProfile -ExecutionPolicy Bypass -File $BackupScript -BackupRoot $BackupRoot -NpxExecutable $MockNpx 2>&1)
  $exitCode = $LASTEXITCODE
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

  $acl = Get-Acl -LiteralPath $BackupRoot
  Assert-True ($acl.AreAccessRulesProtected) 'Backup directory ACL is inheriting permissions.'
  $expectedSids = @([System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value, 'S-1-5-18', 'S-1-5-32-544') | Sort-Object -Unique
  $actualSids = @($acl.Access | ForEach-Object { $_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value } | Sort-Object -Unique)
  Assert-True (($actualSids -join ',') -eq ($expectedSids -join ',')) 'Backup directory ACL contains unexpected principals.'

  $calls = Get-Content -LiteralPath $CallLog
  Assert-True ($calls.Count -eq 4) 'Expected a version check and three dump invocations.'
  Assert-True (($calls -join "`n") -notmatch '--dry-run') 'The runner must never invoke Supabase CLI dry-run.'
  Assert-True ((@($calls | Where-Object { $_ -match 'db\|dump\|--linked' }).Count) -eq 3) 'Expected three linked-project dump commands.'
  Assert-True (($calls -join "`n") -match '--role-only') 'Role-only export flag is missing.'
  Assert-True (($calls -join "`n") -match '--data-only') 'Data-only export flag is missing.'

  Write-Output 'Backup runner self-test passed: pinned CLI, linked RR Capital guard, three exports, protected ACL, manifest hashes, and output suppression.'
}
finally {
  Remove-Item Env:\RR_BACKUP_SELFTEST_CALL_LOG -ErrorAction SilentlyContinue
  $resolvedTestRoot = [System.IO.Path]::GetFullPath($TestRoot)
  $requiredPrefix = $TempRoot + [System.IO.Path]::DirectorySeparatorChar + 'rr capital backup selftest-'
  if ($resolvedTestRoot.StartsWith($requiredPrefix, [System.StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $resolvedTestRoot)) {
    Remove-Item -LiteralPath $resolvedTestRoot -Recurse -Force
  } else {
    throw 'Refusing to remove a self-test path outside its unique temporary directory.'
  }
}
