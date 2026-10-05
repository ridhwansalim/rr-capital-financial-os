import { copyFile, mkdir, readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'

const publicAndroidDir = path.resolve('public/android')
const distAndroidDir = path.resolve('dist/android')
const manifest = JSON.parse(await readFile(path.join(publicAndroidDir, 'version.json'), 'utf8'))
const apk = await readFile(path.join(publicAndroidDir, 'RR-Capital.apk'))
const checksum = createHash('sha256').update(apk).digest('hex')

if (manifest.packageId !== 'com.rrcapital.finance'
  || !Number.isSafeInteger(manifest.versionCode)
  || !manifest.apkUrl
  || checksum !== String(manifest.sha256).toLowerCase()) {
  throw new Error('The staged Android APK does not match its release manifest.')
}

await mkdir(distAndroidDir, { recursive: true })
await copyFile(path.join(publicAndroidDir, 'RR-Capital.apk'), path.join(distAndroidDir, 'RR-Capital.apk'))
await copyFile(path.join(publicAndroidDir, 'version.json'), path.join(distAndroidDir, 'version.json'))
process.stdout.write(`Staged verified Android APK for deployment: ${manifest.versionName} (${manifest.versionCode})\n`)
