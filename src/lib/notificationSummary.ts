// Compatibility exports while the notification surfaces consume the shared
// Dashboard/Notification intelligence model.
export {
  DashboardInsightsContext as NotificationSummaryContext,
  useDashboardInsights as useNotificationSummary,
} from './dashboardInsights'
export type { DashboardInsights as NotificationSummary, ActionableAlert } from './dashboardInsights'
import { useDashboardInsightsContext } from './dashboardInsights'

export function useNotificationSummaryContext() {
  const summary = useDashboardInsightsContext()
  return summary || { approvalCount: 0, offlineCount: 0, alerts: [], loading: true }
}
