[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$SnapshotPath
)

$ErrorActionPreference = 'Stop'
$ExpectedProjectRef = 'hnebvwfgsotrknxpgpmv'
$ExpectedFiles = @('roles.sql', 'schema.sql', 'data.sql')
$CurrentSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$AllowedSids = @($CurrentSid, 'S-1-5-18', 'S-1-5-32-544') | Sort-Object -Unique

function Assert-ProtectedOwnerAcl {
  param([Parameter(Mandatory = $true)][string]$Path, [Parameter(Mandatory = $true)][bool]$RequireProtected)

  $acl = Get-Acl -LiteralPath $Path
  if ($acl.AreAccessRulesProtected -ne $RequireProtected) { throw 'Backup ACL inheritance does not match the protected snapshot layout.' }
  $ownerSid = [System.Security.Principal.NTAccount]::new($acl.Owner).Translate([System.Security.Principal.SecurityIdentifier]).Value
  if ($ownerSid -ne $CurrentSid) { throw 'Backup item is not owned by the current account.' }
  if (@($acl.Access | Where-Object {
    $_.AccessControlType -ne [System.Security.AccessControl.AccessControlType]::Allow -or
    $_.FileSystemRights -ne [System.Security.AccessControl.FileSystemRights]::FullControl
  }).Count -gt 0) { throw 'Backup ACL contains a deny or non-FullControl permission.' }
  $actualSids = @($acl.Access | ForEach-Object { $_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value } | Sort-Object -Unique)
  if (($actualSids -join ',') -ne ($AllowedSids -join ',')) { throw 'Backup ACL contains an unexpected principal.' }
  if (-not $RequireProtected -and @($acl.Access | Where-Object { -not $_.IsInherited }).Count -gt 0) {
    throw 'Snapshot items must inherit permissions only from the protected backup root.'
  }
}

$resolvedPath = (Resolve-Path -LiteralPath $SnapshotPath).Path
$snapshot = Get-Item -LiteralPath $resolvedPath -Force
if (-not $snapshot.PSIsContainer -or ($snapshot.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
  throw 'Snapshot must be a real directory, not a reparse point.'
}
$backupRoot = $snapshot.Parent.FullName
$rootItem = Get-Item -LiteralPath $backupRoot -Force
if (($rootItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Backup root cannot be a reparse point.' }
Assert-ProtectedOwnerAcl -Path $backupRoot -RequireProtected $true
Assert-ProtectedOwnerAcl -Path $resolvedPath -RequireProtected $false

$manifestPath = Join-Path $resolvedPath 'manifest.json'
if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) { throw 'Snapshot manifest is missing.' }
Assert-ProtectedOwnerAcl -Path $manifestPath -RequireProtected $false
try { $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json } catch { throw 'Snapshot manifest is not valid JSON.' }
if ($manifest.status -ne 'complete') { throw 'Snapshot is not marked complete.' }
if ($manifest.project_ref -ne $ExpectedProjectRef) { throw 'Snapshot belongs to a different Supabase project.' }
if ([string]::IsNullOrWhiteSpace([string]$manifest.scope)) { throw 'Snapshot manifest is missing its scope statement.' }

$records = @($manifest.files)
if ($records.Count -ne $ExpectedFiles.Count) { throw 'Snapshot manifest does not describe exactly the required three export files.' }
$actualNames = @($records | ForEach-Object { [string]$_.name } | Sort-Object -Unique)
if (($actualNames -join ',') -ne (($ExpectedFiles | Sort-Object) -join ',')) { throw 'Snapshot manifest has missing, duplicate, or unexpected filenames.' }

$entries = @(Get-ChildItem -LiteralPath $resolvedPath -Force)
$expectedEntryNames = @($ExpectedFiles) + 'manifest.json'
if (($entries.Name | Sort-Object) -join ',' -ne (($expectedEntryNames | Sort-Object) -join ',')) {
  throw 'Snapshot folder contains missing or unexpected files.'
}

foreach ($record in $records) {
  $path = Join-Path $resolvedPath ([string]$record.name)
  $file = Get-Item -LiteralPath $path -Force
  if (-not $file.PSIsContainer -and ($file.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
    throw "Backup file $($record.name) cannot be a reparse point."
  }
  if ($file.PSIsContainer -or $file.Length -le 0) { throw "Backup file $($record.name) is empty or not a regular file." }
  Assert-ProtectedOwnerAcl -Path $path -RequireProtected $false
  if ([long]$record.bytes -ne $file.Length) { throw "Backup size does not match manifest for $($record.name)." }
  if ([string]$record.sha256 -notmatch '^[A-Fa-f0-9]{64}$') { throw "Backup manifest hash is invalid for $($record.name)." }
  $hash = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash
  if ($hash -ne [string]$record.sha256) { throw "Backup hash does not match manifest for $($record.name)." }
}

Write-Output 'RR Capital backup integrity check passed: manifest, project reference, protected ACLs, expected files, sizes, and SHA-256 hashes.'
Write-Output "Snapshot: $resolvedPath"
