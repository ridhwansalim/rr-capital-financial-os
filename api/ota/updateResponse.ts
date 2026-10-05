export type OtaRelease = { version: string; url: string; checksum: string }

export type OtaUpdateResponse = OtaRelease | {
  kind: 'up_to_date'
  message: string
}

function compareVersions(left: string, right: string) {
  const a = left.split(/[+-]/, 1)[0].split('.').map(Number)
  const b = right.split(/[+-]/, 1)[0].split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    const diff = (a[i] || 0) - (b[i] || 0)
    if (diff) return diff
  }
  return 0
}

export function getOtaUpdateResponse(currentValue: unknown, latest: OtaRelease): OtaUpdateResponse {
  const current = String(currentValue || '0.0.0')
  if (current === latest.version || (current !== 'builtin' && compareVersions(current, latest.version) >= 0)) {
    return { kind: 'up_to_date', message: 'No web bundle update is available.' }
  }
  return latest
}
