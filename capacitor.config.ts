import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.rrcapital.finance',
  appName: 'RR Capital',
  webDir: 'dist',
  android: {
    allowMixedContent: false,
  },
  plugins: {
    CapacitorUpdater: {
      appId: 'com.rrcapital.finance',
      version: '2026.10.6',
      autoUpdate: 'atBackground',
      updateUrl: 'https://financial-os-orcin-ten.vercel.app/api/ota/updates',
      statsUrl: '',
      appReadyTimeout: 10000,
      autoDeleteFailed: true,
      autoDeletePrevious: true,
    },
  },
}

export default config
