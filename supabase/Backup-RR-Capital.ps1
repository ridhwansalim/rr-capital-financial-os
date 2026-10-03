[CmdletBinding()]
param(
  [string]$BackupRoot = (Join-Path $env:LOCALAPPDATA 'RR-Capital-Backups'),
  [string]$NpxExecutable = ''
)

$ErrorActionPreference = 'Stop'
$ExpectedProjectRef = 'hnebvwfgsotrknxpgpmv'
$CliVersion = '2.119.0'
$RepositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$LinkFile = Join-Path $RepositoryRoot 'supabase/.temp/project-ref'

if (-not (Test-Path -LiteralPath $LinkFile -PathType Leaf)) {
  throw 'This checkout is not linked to RR Capital. Link it to the RR Capital project, then rerun the backup.'
}

$LinkedProjectRef = (Get-Content -LiteralPath $LinkFile -Raw).Trim()
if ($LinkedProjectRef -ne $ExpectedProjectRef) {
  throw 'Backup stopped because this checkout is linked to a different Supabase project.'
}

if ([string]::IsNullOrWhiteSpace($NpxExecutable)) {
  $NpxCommand = Get-Command 'npx.cmd' -ErrorAction SilentlyContinue
  if (-not $NpxCommand) { $NpxCommand = Get-Command 'npx' -ErrorAction SilentlyContinue }
  if (-not $NpxCommand) { throw 'Node.js npx was not found. Install Node.js before running this backup.' }
  $NpxExecutable = $NpxCommand.Source
}

if (-not (Test-Path -LiteralPath $NpxExecutable -PathType Leaf)) {
  throw 'The configured npx executable does not exist.'
}

$VersionOutput = @(& $NpxExecutable --yes "supabase@$CliVersion" --version 2>$null)
$VersionExitCode = $LASTEXITCODE
$VersionLines = @($VersionOutput | ForEach-Object { ([string]$_).Trim() } | Where-Object { $_ })
if ($VersionExitCode -ne 0 -or $VersionLines.Count -ne 1 -or $VersionLines[0] -ne $CliVersion) {
  throw "Could not verify the pinned Supabase CLI version $CliVersion. No database dump was started."
}

function Assert-OwnerOnlyAcl {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][bool]$RequireProtected,
    [Parameter(Mandatory = $true)][bool]$RequireInheritedRules
  )

  $CurrentSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
  $AllowedSids = @(
    $CurrentSid,
    [System.Security.Principal.SecurityIdentifier]::new('S-1-5-18'),
    [System.Security.Principal.SecurityIdentifier]::new('S-1-5-32-544')
  )

  $VerifiedAcl = Get-Acl -LiteralPath $Path
  if ($VerifiedAcl.AreAccessRulesProtected -ne $RequireProtected) {
    throw 'Backup folder inheritance does not match the expected protected-root layout; no database dump was started.'
  }
  $ExpectedOwnerSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  $ActualOwnerSid = [System.Security.Principal.NTAccount]::new($VerifiedAcl.Owner).Translate([System.Security.Principal.SecurityIdentifier]).Value
  if ($ActualOwnerSid -ne $ExpectedOwnerSid) {
    throw 'Backup folder is not owned by the current account; no database dump was started.'
  }
  if (@($VerifiedAcl.Access | Where-Object {
    $_.AccessControlType -ne [System.Security.AccessControl.AccessControlType]::Allow -or
    $_.FileSystemRights -ne [System.Security.AccessControl.FileSystemRights]::FullControl
  }).Count -gt 0) {
    throw 'Backup folder ACL does not grant only FullControl to its approved principals; no database dump was started.'
  }

  $ActualSids = @(
    $VerifiedAcl.Access | ForEach-Object {
      $_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value
    } | Sort-Object -Unique
  )
  $ExpectedSids = @($AllowedSids | ForEach-Object { $_.Value } | Sort-Object -Unique)
  if (($ActualSids -join ',') -ne ($ExpectedSids -join ',')) {
    throw 'Backup folder ACL contains an unexpected principal; no database dump was started.'
  }
  if ($RequireInheritedRules -and @($VerifiedAcl.Access | Where-Object { -not $_.IsInherited }).Count -gt 0) {
    throw 'Snapshot folder contains explicit ACL rules instead of inheriting only from the protected backup root.'
  }
}

function Invoke-PinnedSupabaseDump {
  param([Parameter(Mandatory = $true)][string[]]$Arguments)

  $OutputId = [guid]::NewGuid().ToString('N')
  $StandardOutputPath = Join-Path $SnapshotPath ('.cli-' + $OutputId + '.stdout')
  $StandardErrorPath = Join-Path $SnapshotPath ('.cli-' + $OutputId + '.stderr')
  $AllArguments = @('--yes', "supabase@$CliVersion") + $Arguments
  $ArgumentLine = '"' + ($AllArguments -join '" "') + '"'
  $ExitCode = -1
  try {
    $Process = Start-Process -FilePath $NpxExecutable -ArgumentList $ArgumentLine -RedirectStandardOutput $StandardOutputPath -RedirectStandardError $StandardErrorPath -Wait -PassThru -NoNewWindow
    $ExitCode = $Process.ExitCode
  }
  finally {
    Remove-Item -LiteralPath $StandardOutputPath, $StandardErrorPath -Force -ErrorAction SilentlyContinue
  }
  if ($ExitCode -ne 0) {
    throw "The Supabase dump command failed with exit code $ExitCode. The snapshot manifest remains marked in_progress; do not restore it."
  }
}

if (-not (Test-Path -LiteralPath $BackupRoot -PathType Container)) {
  throw 'The protected backup root does not exist. Create and verify it before running an export; no database dump was started.'
}
$BackupRoot = (Resolve-Path -LiteralPath $BackupRoot).Path
$RootItem = Get-Item -LiteralPath $BackupRoot -Force
if (($RootItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
  throw 'Backup root cannot be a symbolic link or reparse point.'
}
Assert-OwnerOnlyAcl -Path $BackupRoot -RequireProtected $true -RequireInheritedRules $false

$SnapshotName = (Get-Date).ToString('yyyyMMdd-HHmmss-fff')
$SnapshotPath = Join-Path $BackupRoot $SnapshotName
if (Test-Path -LiteralPath $SnapshotPath) { throw 'A backup folder with this timestamp already exists.' }
[void](New-Item -ItemType Directory -Path $SnapshotPath)
$SnapshotItem = Get-Item -LiteralPath $SnapshotPath -Force
if (($SnapshotItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
  throw 'Snapshot folder cannot be a symbolic link or reparse point.'
}
Assert-OwnerOnlyAcl -Path $SnapshotPath -RequireProtected $false -RequireInheritedRules $true

$ManifestPath = Join-Path $SnapshotPath 'manifest.json'
$Manifest = [ordered]@{
  status = 'in_progress'
  created_at_utc = [DateTime]::UtcNow.ToString('o')
  project_ref = $ExpectedProjectRef
  supabase_cli_version = $CliVersion
  files = @()
  scope = 'roles.sql, schema.sql, and data.sql; Supabase-managed Auth, Storage, extension schemas, and project-level settings are excluded.'
}
$Manifest | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $ManifestPath -Encoding UTF8

Push-Location $RepositoryRoot
try {
  Invoke-PinnedSupabaseDump -Arguments @('db', 'dump', '--linked', '--file', (Join-Path $SnapshotPath 'roles.sql'), '--role-only')
  Invoke-PinnedSupabaseDump -Arguments @('db', 'dump', '--linked', '--file', (Join-Path $SnapshotPath 'schema.sql'))
  Invoke-PinnedSupabaseDump -Arguments @('db', 'dump', '--linked', '--file', (Join-Path $SnapshotPath 'data.sql'), '--use-copy', '--data-only')
}
finally {
  Pop-Location
}

$FileRecords = foreach ($Name in @('roles.sql', 'schema.sql', 'data.sql')) {
  $FilePath = Join-Path $SnapshotPath $Name
  if (-not (Test-Path -LiteralPath $FilePath -PathType Leaf)) {
    throw "Backup is incomplete: expected $Name was not created. The manifest remains in_progress."
  }
  $File = Get-Item -LiteralPath $FilePath
  if ($File.Length -le 0) { throw "Backup is incomplete: $Name is empty. The manifest remains in_progress." }
  $FileAcl = Get-Acl -LiteralPath $FilePath
  $FileOwnerSid = [System.Security.Principal.NTAccount]::new($FileAcl.Owner).Translate([System.Security.Principal.SecurityIdentifier]).Value
  if ($FileOwnerSid -ne [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value) {
    throw "Backup is incomplete: $Name is not owned by the current account. The manifest remains in_progress."
  }
  if (@($FileAcl.Access | Where-Object {
    $_.AccessControlType -ne [System.Security.AccessControl.AccessControlType]::Allow -or
    $_.FileSystemRights -ne [System.Security.AccessControl.FileSystemRights]::FullControl
  }).Count -gt 0) {
    throw "Backup is incomplete: $Name does not inherit only the approved FullControl ACL. The manifest remains in_progress."
  }
  $FileSids = @($FileAcl.Access | ForEach-Object { $_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value } | Sort-Object -Unique)
  $AllowedFileSids = @(
    [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value,
    'S-1-5-18',
    'S-1-5-32-544'
  ) | Sort-Object -Unique
  if (($FileSids -join ',') -ne ($AllowedFileSids -join ',')) {
    throw "Backup is incomplete: $Name has an unexpected access-control entry. The manifest remains in_progress."
  }
  $Hash = Get-FileHash -LiteralPath $FilePath -Algorithm SHA256
  [ordered]@{ name = $Name; bytes = $File.Length; sha256 = $Hash.Hash }
}

$Manifest.status = 'complete'
$Manifest.files = @($FileRecords)
$Manifest | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $ManifestPath -Encoding UTF8

Write-Output "Backup completed and verified for RR Capital. Snapshot: $SnapshotPath"
Write-Output 'Manifest records file sizes and SHA-256 hashes. This is a database-only export, not a full Supabase project backup.'
