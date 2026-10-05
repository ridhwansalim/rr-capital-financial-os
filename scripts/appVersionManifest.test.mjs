import assert from 'node:assert/strict'
import { createAppVersionManifest } from './appVersionManifest.mjs'

const manifest = await createAppVersionManifest({
  version: '2026.10.1234567890',
  commit: 'abc123def456',
  env: { RR_MIN_NATIVE_VERSION: '20261007' },
})

assert.equal(manifest.version, '2026.10.1234567890')
assert.equal(manifest.build, 20261007)
assert.equal(manifest.commit, 'abc123def456')
assert.equal(manifest.minNativeVersion, 20261007)
assert.match(manifest.apkUrl, /^https:\/\//)
await assert.rejects(
  createAppVersionManifest({ version: 'bad-version', commit: 'test' }),
  /three numeric components/,
)

console.info('App version manifest tests passed.')
