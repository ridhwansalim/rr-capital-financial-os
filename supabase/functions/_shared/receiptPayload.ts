import { readBoundedJson } from "./boundedJson.ts"

export const maxReceiptBodyBytes = 11_500_000
export const maxReceiptImageBytes = 8 * 1024 * 1024

const allowedMimeTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"])
const maxBase64Length = 4 * Math.ceil(maxReceiptImageBytes / 3)

function isBase64(value: string): boolean {
  if (value.length === 0 || value.length % 4 !== 0) return false

  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0
  const contentLength = value.length - padding
  if (contentLength === 0) return false

  for (let i = 0; i < contentLength; i++) {
    const code = value.charCodeAt(i)
    const isLetter = (code >= 65 && code <= 90) || (code >= 97 && code <= 122)
    const isDigit = code >= 48 && code <= 57
    if (!isLetter && !isDigit && code !== 43 && code !== 47) return false
  }

  for (let i = contentLength; i < value.length; i++) {
    if (value.charCodeAt(i) !== 61) return false
  }
  return true
}

export type ReceiptPayload = { mimeType: string; imageBase64: string }
export type ReceiptPayloadResult =
  | { ok: true; value: ReceiptPayload }
  | { ok: false; status: 400 | 413 }

/** Stream, bound, and validate receipt JSON before the edge handler uses it. */
export async function readReceiptPayload(request: Request): Promise<ReceiptPayloadResult> {
  const parsed = await readBoundedJson(request, maxReceiptBodyBytes)
  if (!parsed.ok) return parsed

  const value = parsed.value
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, status: 400 }
  }

  const payload = value as Record<string, unknown>
  if (typeof payload.mimeType !== "string" || !allowedMimeTypes.has(payload.mimeType) ||
      typeof payload.imageBase64 !== "string") {
    return { ok: false, status: 400 }
  }

  if (payload.imageBase64.length > maxBase64Length) return { ok: false, status: 413 }
  if (!isBase64(payload.imageBase64)) return { ok: false, status: 400 }

  const padding = payload.imageBase64.endsWith("==") ? 2 : payload.imageBase64.endsWith("=") ? 1 : 0
  const imageBytes = Math.floor(payload.imageBase64.length * 3 / 4) - padding
  if (imageBytes < 1) return { ok: false, status: 400 }
  if (imageBytes > maxReceiptImageBytes) return { ok: false, status: 413 }

  return {
    ok: true,
    value: { mimeType: payload.mimeType, imageBase64: payload.imageBase64 },
  }
}
