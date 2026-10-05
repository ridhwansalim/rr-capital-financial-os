import assert from 'node:assert/strict'
import { getOtaVersion } from './otaVersion.mjs'

{
  const earlier = getOtaVersion(new Date('2026-10-05T01:02:03.004Z'), '')
  const later = getOtaVersion(new Date('2026-10-05T01:02:03.005Z'), '')
  const tomorrow = getOtaVersion(new Date('2026-10-06T00:00:00.000Z'), '')
  assert.match(earlier, /^2026\.10\.\d+$/)
  assert.notEqual(earlier, later)
  assert.ok(later < tomorrow)
}

{
  assert.equal(getOtaVersion(new Date(), '2026.10.6'), '2026.10.6')
  assert.throws(() => getOtaVersion(new Date(), '2026.10.6-beta'))
}

console.info('OTA release version tests passed.')
