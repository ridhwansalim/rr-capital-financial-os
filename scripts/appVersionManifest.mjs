import { spawnSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

const DEFAULT_APK_URL = 'https://financial-os-orcin-ten.vercel.app/android/RR-Capital.apk'

export async function createAppVersionManifest({
  root = process.cwd(),
  version,
  env = process.env,
  commit,
} = {}) {
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error('App release version must use three numeric components.')
  }

  const gradle = await readFile(path.join(root, 'android/app/build.gradle'), 'utf8')
  const build = Number(gradle.match(/versionCode\s+(\d+)/)?.[1])
  if (!Number.isSafeInteger(build) || build <= 0) {
    throw new Error('Could not read a valid Android versionCode from android/app/build.gradle.')
  }

  const minNativeVersion = Number(env.RR_MIN_NATIVE_VERSION ?? 1)
  if (!Number.isSafeInteger(minNativeVersion) || minNativeVersion < 1) {
    throw new Error('RR_MIN_NATIVE_VERSION must be a positive integer.')
  }

  let resolvedCommit = commit
  if (!resolvedCommit) {
    const result = spawnSync('git', ['rev-parse', '--short=12', 'HEAD'], { cwd: root, encoding: 'utf8' })
    resolvedCommit = result.status === 0 ? result.stdout.trim() : 'unknown'
  }

  return {
    version,
    build,
    commit: resolvedCommit || 'unknown',
    minNativeVersion,
    apkUrl: env.RR_APK_URL || DEFAULT_APK_URL,
  }
}
