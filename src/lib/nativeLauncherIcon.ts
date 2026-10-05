import { Capacitor, registerPlugin } from '@capacitor/core'

export type LauncherIconId = 'system' | 'dark' | 'cream' | 'monochrome'

interface LauncherIconPlugin {
  setIcon(options: { icon: LauncherIconId }): Promise<{ icon: LauncherIconId }>
  getIcon(): Promise<{ icon: LauncherIconId }>
}

const LauncherIcon = registerPlugin<LauncherIconPlugin>('LauncherIcon')

export async function getNativeLauncherIcon(): Promise<LauncherIconId> {
  if (!Capacitor.isNativePlatform()) return 'system'
  const result = await LauncherIcon.getIcon()
  return result.icon
}

export async function setNativeLauncherIcon(icon: LauncherIconId): Promise<LauncherIconId> {
  if (!Capacitor.isNativePlatform()) throw new Error('Launcher icon selection is available in the Android app.')
  const result = await LauncherIcon.setIcon({ icon })
  return result.icon
}
