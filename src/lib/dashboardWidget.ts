import { Capacitor, registerPlugin } from '@capacitor/core'

export type AndroidWidgetSummary = {
  signedIn: boolean
  netWorth: number
  safeLeftover: number
  netFlow30Day: number
  nextDueName: string
  nextDueDate: string
  nextDueAmount: number | null
}

interface DashboardWidgetPlugin {
  syncSummary(summary: {
    signedIn: boolean
    netWorth: string
    safeLeftover: string
    netFlow30Day: string
    nextDueName: string
    nextDueDate: string
    nextDueAmount: string
  }): Promise<{ updated: boolean }>
}

const DashboardWidget = registerPlugin<DashboardWidgetPlugin>('DashboardWidget')
const currency = new Intl.NumberFormat('en-IN', {
  style: 'currency', currency: 'INR', maximumFractionDigits: 0,
})

export async function syncAndroidDashboardWidget(summary: AndroidWidgetSummary): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  try {
    await DashboardWidget.syncSummary({
      signedIn: summary.signedIn,
      netWorth: currency.format(summary.netWorth),
      safeLeftover: currency.format(summary.safeLeftover),
      netFlow30Day: currency.format(summary.netFlow30Day),
      nextDueName: summary.nextDueName,
      nextDueDate: summary.nextDueDate,
      nextDueAmount: summary.nextDueAmount == null ? '' : currency.format(summary.nextDueAmount),
    })
  } catch {
    // A missing widget or a transient native bridge error should not affect the app.
  }
}
