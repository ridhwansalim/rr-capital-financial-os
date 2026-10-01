param(
  [Parameter(Mandatory = $true)][string]$SourcePath,
  [Parameter(Mandatory = $true)][string]$DestinationPath
)

$source = (Resolve-Path -LiteralPath $SourcePath).Path
$sql = Get-Content -LiteralPath $source -Raw -Encoding UTF8
$pattern = '(?s)CREATE OR REPLACE FUNCTION "public"\."notify_telegram_on_transaction"\(\) RETURNS "trigger".*?ALTER FUNCTION "public"\."notify_telegram_on_transaction"\(\) OWNER TO "postgres";'
$matches = [regex]::Matches($sql, $pattern)
if ($matches.Count -ne 1) { throw "Expected one legacy Telegram function; found $($matches.Count)." }
$safeFunction = @'
CREATE OR REPLACE FUNCTION "public"."notify_telegram_on_transaction"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$ BEGIN RETURN NEW; END; $$;

ALTER FUNCTION "public"."notify_telegram_on_transaction"() OWNER TO "postgres";
'@
$sql = [regex]::Replace($sql, $pattern, [System.Text.RegularExpressions.MatchEvaluator]{ param($match) $safeFunction })
if ($sql -match '\b[0-9]{8,12}:[A-Za-z0-9_-]{30,}\b' -or
    $sql -match 'bot_token\s*text\s*:=\s*''[^'']+''') {
  throw 'The baseline still appears to contain an embedded bot credential.'
}
$destination = [System.IO.Path]::GetFullPath($DestinationPath)
[System.IO.File]::WriteAllText($destination, "-- Sanitized pre-hardening RR Capital schema baseline. Requires Supabase auth and extension schemas.`n" + $sql, [System.Text.UTF8Encoding]::new($false))
Write-Output "Wrote sanitized baseline ($($sql.Length) characters)."
