export function createPersonalSummarySql(verifiedUserId: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(verifiedUserId)) {
    throw new Error("Invalid verified Supabase subject")
  }
  const subject = verifiedUserId.toLowerCase()
  return `WITH verified_auth_context AS MATERIALIZED (
  SELECT set_config('request.jwt.claim.sub', '${subject}', true) AS subject,
         set_config('request.jwt.claim.role', 'authenticated', true) AS role,
         set_config('request.jwt.claims', jsonb_build_object(
           'sub', '${subject}', 'role', 'authenticated'
         )::text, true) AS claims
)
SELECT private.personal_summary() AS personal_summary
FROM verified_auth_context`
}

export const RR_CAPITAL_PROJECT_REF = "hnebvwfgsotrknxpgpmv"

export function isScopedPoolerUrl(value: string, expectedProjectRef = RR_CAPITAL_PROJECT_REF): boolean {
  try {
    const url = new URL(value)
    const username = decodeURIComponent(url.username)
    return url.protocol === "postgresql:" &&
      url.port === "6543" &&
      url.hostname.endsWith(".pooler.supabase.com") &&
      username === `perry_reader.${expectedProjectRef}` &&
      decodeURIComponent(url.password).length >= 32 &&
      url.pathname === "/postgres" &&
      url.search === "" &&
      url.hash === ""
  } catch {
    return false
  }
}

export function isRrCapitalUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === "https:" &&
      url.hostname === `${RR_CAPITAL_PROJECT_REF}.supabase.co` &&
      url.username === "" && url.password === "" &&
      url.port === "" && (url.pathname === "" || url.pathname === "/") && url.search === "" && url.hash === ""
  } catch {
    return false
  }
}
