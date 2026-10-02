export const RR_CAPITAL_PROJECT_REF = "hnebvwfgsotrknxpgpmv"

export function isRrCapitalUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === "https:" &&
      url.hostname === `${RR_CAPITAL_PROJECT_REF}.supabase.co` &&
      url.username === "" && url.password === "" &&
      url.port === "" && (url.pathname === "" || url.pathname === "/") &&
      url.search === "" && url.hash === ""
  } catch {
    return false
  }
}
