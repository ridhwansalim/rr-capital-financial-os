import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.rrcapital.finance',
  appName: 'RR Capital',
  webDir: 'dist',
  android: {
    allowMixedContent: false,
  },
}

export default config
