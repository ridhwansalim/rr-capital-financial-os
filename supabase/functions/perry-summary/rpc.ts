export async function invokePersonalSummary(
  supabaseUrl: string,
  apiKey: string,
  accessToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ data: unknown; error: { code?: string } | null }> {
  const response = await fetchImpl(`${supabaseUrl}/rest/v1/rpc/personal_summary`, {
    method: "POST",
    headers: {
      apikey: apiKey,
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: "{}",
    signal: AbortSignal.timeout(5000),
  })
  const data: unknown = await response.json().catch(() => null)
  if (response.ok) return { data, error: null }
  const errorCode = typeof data === "object" && data !== null && "code" in data && typeof data.code === "string"
    ? data.code
    : String(response.status)
  return { data: null, error: { code: errorCode } }
}
