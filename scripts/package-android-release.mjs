import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { createAppVersionManifest } from './appVersionManifest.mjs'

const gradle = await readFile('android/app/build.gradle', 'utf8')
const versionName = gradle.match(/versionName\s+["']([^"']+)["']/)?.[1]
const versionCode = Number(gradle.match(/versionCode\s+(\d+)/)?.[1])
if (!versionName || !Number.isSafeInteger(versionCode) || versionCode <= 0) throw new Error('Could not read a valid Android version from android/app/build.gradle.')

const apkPath = 'android/app/build/outputs/apk/debug/app-debug.apk'
const apk = await readFile(apkPath)
const sha256 = createHash('sha256').update(apk).digest('hex')
const manifest = {
  packageId: 'com.rrcapital.finance',
  versionName,
  versionCode,
  apkUrl: 'https://financial-os-orcin-ten.vercel.app/android/RR-Capital.apk',
  sha256,
  releasedAt: new Date().toISOString(),
}
const appVersionManifest = await createAppVersionManifest({
  version: JSON.parse(await readFile('dist/ota/manifest.json', 'utf8')).version,
})

await mkdir('public/android', { recursive: true })
await copyFile(apkPath, 'public/android/RR-Capital.apk')
await writeFile('public/android/version.json', JSON.stringify(manifest, null, 2) + '\n')
await writeFile('public/version.json', JSON.stringify(appVersionManifest, null, 2) + '\n')
// Keep the web deployment's installer current after the APK has been built.
// The next web build removes this copy before Capacitor sync to avoid nesting.
await mkdir('dist/android', { recursive: true })
await copyFile(apkPath, 'dist/android/RR-Capital.apk')
await writeFile('dist/android/version.json', JSON.stringify(manifest, null, 2) + '\n')
await writeFile('dist/version.json', JSON.stringify(appVersionManifest, null, 2) + '\n')
await writeFile('api/android/releaseManifest.ts', `export const androidReleaseManifest = ${JSON.stringify(manifest)} as const\n`)
process.stdout.write(`Android APK release asset staged: public/android/RR-Capital.apk\nVersion: ${versionName} (${versionCode})\nSHA-256: ${sha256}\n`)
