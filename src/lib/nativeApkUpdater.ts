import { registerPlugin } from '@capacitor/core'

export interface NativeApkUpdatePlugin {
  getInstalledVersion(): Promise<{ versionName: string; versionCode: number }>
  downloadAndInstall(options: { url: string; sha256: string; versionCode: number }): Promise<{ permissionRequired: boolean; downloadedBytes?: number }>
}

export const NativeApkUpdater = registerPlugin<NativeApkUpdatePlugin>('NativeApkUpdater')

export interface AndroidReleaseManifest {
  packageId: string
  versionName: string
  versionCode: number
  apkUrl: string
  sha256: string
  releasedAt: string
}
