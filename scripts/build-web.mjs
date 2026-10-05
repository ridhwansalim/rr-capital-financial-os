import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { mkdir, copyFile, cp, readFile, rm, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { loadEnv } from 'vite'
import { getOtaVersion } from './otaVersion.mjs'
import { createAppVersionManifest } from './appVersionManifest.mjs'

const env = loadEnv('production', process.cwd(), 'VITE_')
const otaVersion = getOtaVersion()
const supabaseUrl = process.env.VITE_SUPABASE_URL || env.VITE_SUPABASE_URL
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Production build requires VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.')
}

const viteBin = fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url))
const result = spawnSync(process.execPath, [viteBin, 'build'], {
  stdio: 'inherit',
  env: {
    ...env,
    ...process.env,
    VITE_SUPABASE_URL: supabaseUrl,
    VITE_SUPABASE_ANON_KEY: supabaseAnonKey,
    VITE_OTA_RELEASE_VERSION: otaVersion,
  },
})

if (result.error) throw result.error
if (result.status !== 0) process.exit(result.status ?? 1)

// Publish a small, cache-busted release snapshot for the app updater UI and
// native startup check. Keep the same manifest in Vite output and OTA bundles.
const appVersionManifest = await createAppVersionManifest({ version: otaVersion })
const appVersionJson = JSON.stringify(appVersionManifest, null, 2) + '\n'
await writeFile(path.resolve('public/version.json'), appVersionJson)
await writeFile(path.resolve('dist/version.json'), appVersionJson)

// The native installer is served as a release asset, not shipped inside the
// WebView app. Remove any previously staged copy before Capacitor sync/build.
await rm(path.resolve('dist/android/RR-Capital.apk'), { force: true })

// Produce the exact Capacitor-Updater bundle layout plus a checksum manifest
// consumed by the self-hosted Vercel update endpoint.
const otaDir = path.resolve('dist/ota')
await mkdir(otaDir, { recursive: true })
const capgoBin = fileURLToPath(new URL('../node_modules/@capgo/cli/dist/index.js', import.meta.url))
const bundleName = `rr-capital-${otaVersion}.zip`
const otaStage = path.resolve('.ota-web-bundle')
await rm(otaStage, { recursive: true, force: true })
await cp(path.resolve('dist'), otaStage, {
  recursive: true,
  filter: source => {
    const relative = path.relative(path.resolve('dist'), source).replaceAll('\\', '/')
    return relative !== 'android' && !relative.startsWith('android/')
  },
})
const zipResult = spawnSync(process.execPath, [capgoBin, 'bundle', 'zip', 'com.rrcapital.finance', '--path', '.ota-web-bundle', '--bundle', otaVersion, '--name', bundleName, '--json'], {
  cwd: process.cwd(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'],
})
await rm(otaStage, { recursive: true, force: true })
if (zipResult.error) throw zipResult.error
if (zipResult.status !== 0) {
  process.stderr.write(zipResult.stdout || '')
  throw new Error('Capgo could not create the Android OTA bundle.')
}
let archivePath = path.resolve(bundleName)
try { await readFile(archivePath) } catch {
  archivePath = path.resolve('dist', bundleName)
  try { await readFile(archivePath) } catch { archivePath = path.resolve(bundleName.replace(/\.zip$/, `-${otaVersion}.zip`)); await readFile(archivePath) }
}
const publishedArchive = path.join(otaDir, bundleName)
if (archivePath !== publishedArchive) await copyFile(archivePath, publishedArchive)
const checksum = createHash('sha256').update(await readFile(publishedArchive)).digest('hex')
const releaseManifest = {
  version: otaVersion,
  url: `https://financial-os-orcin-ten.vercel.app/ota/${bundleName}`,
  checksum,
}
await writeFile(path.join(otaDir, 'manifest.json'), JSON.stringify(releaseManifest, null, 2) + '\n')
await mkdir(path.resolve('public/ota'), { recursive: true })
// Bundle release metadata into the Vercel function at build time, avoiding a
// serverless self-fetch through deployment routing/authentication.
await writeFile(path.resolve('api/ota/releaseManifest.ts'), `export const releaseManifest = ${JSON.stringify(releaseManifest)} as const\n`)
await writeFile(path.resolve('public/ota/manifest.json'), JSON.stringify(releaseManifest, null, 2) + '\n')
process.stdout.write(`Android OTA bundle: ${publishedArchive}\nSHA-256: ${checksum}\n`)
