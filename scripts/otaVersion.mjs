const VERSION_PATTERN = /^\d+\.\d+\.\d+$/

export function getOtaVersion(date = new Date(), override = process.env.RR_OTA_RELEASE_VERSION) {
  if (override?.trim()) {
    const version = override.trim()
    if (!VERSION_PATTERN.test(version)) {
      throw new Error('RR_OTA_RELEASE_VERSION must use three numeric version components.')
    }
    return version
  }

  const pad = (value, length = 2) => String(value).padStart(length, '0')
  // Keep the leading date component unpadded because SemVer forbids leading
  // zeros in numeric identifiers, while retaining chronological sort order.
  const patch = `${date.getUTCDate()}${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}${pad(date.getUTCMilliseconds(), 3)}`
  return `${date.getUTCFullYear()}.${pad(date.getUTCMonth() + 1)}.${patch}`
}
