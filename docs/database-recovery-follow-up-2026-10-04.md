# Current-schema backup follow-up - 2026-10-04

Snapshot `%LOCALAPPDATA%\\RR-Capital-Backups\\20261004-230810-428` was freshly exported from RR Capital with the repository's pinned Supabase CLI 2.119.0 backup script. `Test-RR-Capital-Backup.ps1` verified complete status, project reference, protected owner-only ACLs, expected files, byte sizes, and SHA-256 hashes. This is a current application-schema database export, not a full Supabase project backup; managed Auth/Storage data and project settings remain outside its scope.

An isolated schema-and-data restore was attempted against the existing `rr-capital-restore-check` container but could not start because Docker Desktop denied access to its named pipe. The snapshot itself is intact; restore compatibility for this new snapshot is not yet verified. No hosted writes or local container changes occurred.
