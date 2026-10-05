import assert from 'node:assert/strict'
import { getOtaUpdateResponse } from '../api/ota/updateResponse.ts'

const latest = {
  version: '2026.10.5123456789',
  url: 'https://example.test/rr-capital.zip',
  checksum: 'a'.repeat(64),
}

assert.deepEqual(getOtaUpdateResponse('builtin', latest), latest)
assert.deepEqual(getOtaUpdateResponse('2026.10.5123456788', latest), latest)
assert.deepEqual(getOtaUpdateResponse(latest.version, latest), {
  kind: 'up_to_date',
  message: 'No web bundle update is available.',
})
assert.deepEqual(getOtaUpdateResponse('2026.10.6000000000', latest), {
  kind: 'up_to_date',
  message: 'No web bundle update is available.',
})

console.info('Capacitor OTA response contract tests passed.')
