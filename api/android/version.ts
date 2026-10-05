import { androidReleaseManifest } from './releaseManifest.js'

type VercelRequest = { method?: string }
type VercelResponse = { setHeader(name: string, value: string): void; status(code: number): VercelResponse; json(value: unknown): void }

export default function androidVersion(_req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store, max-age=0')
  res.setHeader('Access-Control-Allow-Origin', '*')
  if (_req.method !== 'GET' && _req.method !== 'HEAD') return res.status(405).json({ message: 'Method not allowed.' })
  return res.status(200).json(androidReleaseManifest)
}
