import { releaseManifest } from './releaseManifest.js'
import { getOtaUpdateResponse } from './updateResponse.js'

type VercelRequest = { method?: string; body?: unknown }
type VercelResponse = { setHeader(name: string, value: string): void; status(code: number): VercelResponse; json(value: unknown): void }

export default async function updates(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store, max-age=0')
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(204).json({})
  if (req.method !== 'POST') return res.status(405).json({ message: 'Method not allowed.' })

  const latest = releaseManifest
  if (!latest.version || !/^\d+\.\d+\.\d+$/.test(latest.version) || !latest.url || !/^https:\/\//.test(latest.url) || !/^[a-f0-9]{64}$/i.test(latest.checksum || '')) {
    return res.status(503).json({ message: 'Web update manifest is invalid.' })
  }
  const body = req.body as { version_name?: unknown } | undefined
  return res.status(200).json(getOtaUpdateResponse(body?.version_name, latest))
}
