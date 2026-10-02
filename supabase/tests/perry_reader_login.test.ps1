param(
  [string]$SupabaseCli = ''
)

$ErrorActionPreference = 'Continue'
if ([string]::IsNullOrWhiteSpace($SupabaseCli)) {
  $SupabaseCli = if ([string]::IsNullOrWhiteSpace($env:SUPABASE_CLI)) { 'supabase' } else { $env:SUPABASE_CLI }
}
$owner = [guid]::NewGuid().ToString()
$other = [guid]::NewGuid().ToString()
$account = [guid]::NewGuid().ToString()
$transaction = [guid]::NewGuid().ToString()
$writeProbe = [guid]::NewGuid().ToString()
$randomBytes = New-Object byte[] 32
$rng = New-Object System.Security.Cryptography.RNGCryptoServiceProvider
$rng.GetBytes($randomBytes)
$rng.Dispose()
$password = [Convert]::ToBase64String($randomBytes).Replace('+', 'A').Replace('/', 'B').TrimEnd('=')
$databaseUrl = "postgresql://perry_reader:$password@127.0.0.1:54322/postgres"
$configured = $false
$startedHere = $false
$testFailed = $false

function Invoke-Supabase([string[]]$Arguments) {
  $output = @(& $script:SupabaseCli @Arguments 2>$null)
  return [pscustomobject]@{ ExitCode = $LASTEXITCODE; Output = $output }
}

function Read-QueryResult($Invocation) {
  if ($Invocation.ExitCode -ne 0) { throw 'Local SQL operation failed.' }
  $text = $Invocation.Output -join [Environment]::NewLine
  $jsonStart = $text.IndexOf('{')
  if ($jsonStart -lt 0) { return $null }
  return ($text.Substring($jsonStart) | ConvertFrom-Json)
}

function Invoke-LocalSql([string]$Sql) {
  return Read-QueryResult (Invoke-Supabase @('db', 'query', '--local', $Sql))
}

function Invoke-ReaderSql([string]$Sql) {
  return Read-QueryResult (Invoke-Supabase @('db', 'query', '--db-url', $script:databaseUrl, $Sql))
}

try {
  $probe = Invoke-Supabase @('db', 'query', '--local', 'SELECT 1 AS ready;')
  if ($probe.ExitCode -ne 0) {
    $start = Invoke-Supabase @('start')
    if ($start.ExitCode -ne 0) { throw 'Local Supabase did not start.' }
    $startedHere = $true
    $probe = Invoke-Supabase @('db', 'query', '--local', 'SELECT 1 AS ready;')
    if ($probe.ExitCode -ne 0) { throw 'Local database did not become ready.' }
  }

  $configCount = Read-QueryResult (Invoke-Supabase @('db', 'query', '--local', 'SELECT count(*)::int AS n FROM private.perry_owner_config;'))
  if ($configCount.rows[0].n -ne 0) {
    throw 'Local Perry owner config was already populated; refusing to change it.'
  }

  Read-QueryResult (Invoke-Supabase @('db', 'query', '--local', "ALTER ROLE perry_reader PASSWORD '$password';")) | Out-Null
  $configured = $true
  Invoke-LocalSql "INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES ('$owner','perry-owner-$owner@example.invalid','{}');" | Out-Null
  Invoke-LocalSql "INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES ('$other','perry-other-$other@example.invalid','{}');" | Out-Null
  Invoke-LocalSql "INSERT INTO private.perry_owner_config(singleton,owner_id) VALUES (true,'$owner');" | Out-Null
  Invoke-LocalSql "INSERT INTO public.accounts(id,owner_id,name,type) VALUES ('$account','$owner','synthetic Perry test','bank');" | Out-Null
  Invoke-LocalSql "INSERT INTO public.transactions(id,owner_id,initiator_profile_id,to_account_id,amount,description,status,created_at) VALUES ('$transaction','$owner','$owner','$account',123,'synthetic Perry test row','COMPLETED',now());" | Out-Null

  $ownerSummary = "WITH verified_auth_context AS MATERIALIZED (SELECT set_config('request.jwt.claim.sub','$owner',true),set_config('request.jwt.claim.role','authenticated',true),set_config('request.jwt.claims',jsonb_build_object('sub','$owner','role','authenticated')::text,true)) SELECT personal_summary->'ledger'->>'completed_personal_transaction_count' AS transaction_count, personal_summary->'accounts'->0->>'personal_balance' AS balance FROM verified_auth_context, LATERAL (SELECT private.personal_summary() AS personal_summary) AS summary;"
  $summaryResult = Invoke-ReaderSql $ownerSummary
  if ($summaryResult.rows[0].transaction_count -ne '1' -or $summaryResult.rows[0].balance -ne '123') {
    throw 'Actual reader login returned an unexpected synthetic summary.'
  }

  $otherSubject = "WITH verified_auth_context AS MATERIALIZED (SELECT set_config('request.jwt.claim.sub','$other',true),set_config('request.jwt.claim.role','authenticated',true),set_config('request.jwt.claims',jsonb_build_object('sub','$other','role','authenticated')::text,true)) SELECT private.personal_summary() FROM verified_auth_context;"
  if ((Invoke-Supabase @('db', 'query', '--db-url', $databaseUrl, $otherSubject)).ExitCode -eq 0) {
    throw 'Actual reader login accepted a different auth.uid().'
  }
  if ((Invoke-Supabase @('db', 'query', '--db-url', $databaseUrl, 'SELECT count(*) FROM public.accounts;')).ExitCode -eq 0) {
    throw 'Actual reader login unexpectedly read the accounts table.'
  }
  if ((Invoke-Supabase @('db', 'query', '--db-url', $databaseUrl, 'SELECT public.personal_summary();')).ExitCode -eq 0) {
    throw 'Actual reader login unexpectedly accessed the public schema.'
  }
  if ((Invoke-Supabase @('db', 'query', '--db-url', $databaseUrl, "UPDATE public.accounts SET name='forged' WHERE id='$account';")).ExitCode -eq 0) {
    throw 'Actual reader login unexpectedly updated an account.'
  }
  if ((Invoke-Supabase @('db', 'query', '--db-url', $databaseUrl, "INSERT INTO public.accounts(id,owner_id,name,type) VALUES ('$writeProbe','$owner','forged','bank');")).ExitCode -eq 0) {
    throw 'Actual reader login unexpectedly inserted an account.'
  }
  if ((Invoke-Supabase @('db', 'query', '--db-url', $databaseUrl, "DELETE FROM public.transactions WHERE id='$transaction';")).ExitCode -eq 0) {
    throw 'Actual reader login unexpectedly deleted a transaction.'
  }

  Write-Output 'PASS: actual perry_reader login returns only the pinned synthetic owner summary, rejects another subject, and cannot directly SELECT, INSERT, UPDATE, or DELETE financial rows.'
}
catch {
  $testFailed = $true
  Write-Output ('FAIL: ' + $_.Exception.Message)
}
finally {
  try {
    Invoke-LocalSql "DELETE FROM public.transactions WHERE id='$transaction';" | Out-Null
    Invoke-LocalSql "DELETE FROM public.accounts WHERE id IN ('$account','$writeProbe');" | Out-Null
    Invoke-LocalSql "DELETE FROM private.perry_owner_config WHERE owner_id='$owner';" | Out-Null
    Invoke-LocalSql "DELETE FROM auth.users WHERE id IN ('$owner','$other');" | Out-Null
  }
  finally {
    if ($configured) {
      Invoke-LocalSql 'ALTER ROLE perry_reader PASSWORD NULL;' | Out-Null
    }
    if ($startedHere) {
      Invoke-Supabase @('stop') | Out-Null
    }
  }
}

if ($testFailed) { exit 1 }
