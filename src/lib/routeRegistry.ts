import {
  ArrowRightLeft, CalendarDays, ChartNoAxesCombined, CloudUpload, Calculator,
  HeartPulse, Landmark, LayoutDashboard, PiggyBank, Receipt, Settings, ShoppingBasket,
  Users, Wallet, Bell, type LucideIcon,
} from 'lucide-react'
import type { ComponentType } from 'react'

export type RoutePlacement = 'navbar' | 'settings'
export type SettingsGroup =
  | 'Core Operations & Daily Flow'
  | 'Commitments, Credit & Chittis'
  | 'Vaults, Directory & Sync'
  | 'Analytics, Planning & Wellness'
  | 'Tools & Lifestyle Utilities'
export type FeatureKey = 'budgets' | 'calculators' | 'savings_goals' | 'shopping_lists' | 'financial_health_score'

export interface RouteDefinition {
  path: string
  title: string
  icon: LucideIcon
  settingsGroup: SettingsGroup
  defaultPlacement: RoutePlacement
  mobileDefaultPlacement?: RoutePlacement
  optionalFeature?: FeatureKey
  utility?: boolean
  slots: string[]
}

export const SETTINGS_GROUPS: SettingsGroup[] = [
  'Core Operations & Daily Flow',
  'Commitments, Credit & Chittis',
  'Vaults, Directory & Sync',
  'Analytics, Planning & Wellness',
  'Tools & Lifestyle Utilities',
]

// Canonical protected-page metadata. The router, nav, and Settings launcher all
// consume this registry so moving a route never requires a second menu edit.
export const ROUTE_REGISTRY: RouteDefinition[] = [
  { path: '/', title: 'Dashboard', icon: LayoutDashboard, settingsGroup: SETTINGS_GROUPS[0], defaultPlacement: 'navbar', slots: ['Total Net Worth and This Month’s Commitments', 'Cash Flow range, KPI strip and daily Income/Expense chart', 'Pending Requests for Review and Add Transaction/Debt', 'Recorded Account Balances and 5 Recent Transactions'] },
  { path: '/ledger', title: 'Ledger', icon: ArrowRightLeft, settingsGroup: SETTINGS_GROUPS[0], defaultPlacement: 'navbar', slots: ['Search, Date Range, Vault and Contact filters', 'Chronological Master Transaction Table', 'Selected Transaction Detail and Split Audit'] },
  { path: '/calendar', title: 'Calendar', icon: CalendarDays, settingsGroup: SETTINGS_GROUPS[0], defaultPlacement: 'navbar', mobileDefaultPlacement: 'settings', slots: ['Monthly Cash-Flow and Due-Date Heatmap', 'Selected Day Agenda and Scheduled Commitments'] },
  { path: '/chittis', title: 'Chittis', icon: Landmark, settingsGroup: SETTINGS_GROUPS[1], defaultPlacement: 'navbar', slots: ['Active Chittis, Monthly Outflow and Accumulated Equity', 'Active Chitti Passbooks and Auction Dividend Tracker', 'Installment Schedule and Prize/Security Status'] },
  { path: '/debts', title: 'Debts & IOUs', icon: Receipt, settingsGroup: SETTINGS_GROUPS[1], defaultPlacement: 'settings', slots: ['Monthly EMI Total, Receivables and Payables', 'Loan EMI Amortization and Payoff Schedule', 'Peer-to-Peer IOU and Split Settlement Queue'] },
  { path: '/accounts', title: 'Accounts', icon: Wallet, settingsGroup: SETTINGS_GROUPS[2], defaultPlacement: 'settings', slots: ['Recorded Balance, Liquid Assets and Active Vault Count', 'Optional Account Health diagnostics (embedded in Accounts)', 'Account Vault Cards and Inter-Vault Transfer'] },
  { path: '/contacts', title: 'Contacts', icon: Users, settingsGroup: SETTINGS_GROUPS[2], defaultPlacement: 'settings', slots: ['Contact and Profile Labels Directory', 'Counterparty Ledger Statement and Pending Split History'] },
  { path: '/offline', title: 'Offline queue', icon: CloudUpload, settingsGroup: SETTINGS_GROUPS[2], defaultPlacement: 'settings', slots: ['Queued Mutations, Last Sync and Conflict Status', 'Pending Offline Transactions Outbox and Retry/Discard'] },
  { path: '/reports', title: 'Reports', icon: ChartNoAxesCombined, settingsGroup: SETTINGS_GROUPS[3], defaultPlacement: 'settings', slots: ['Date Range and Daily Drill-Down Filters (transfers excluded)', 'Income vs. Expense Breakdown Workbench', 'Category Burn and Contact Distribution'] },
  { path: '/financial-health', title: 'Financial wellness', icon: HeartPulse, settingsGroup: SETTINGS_GROUPS[3], defaultPlacement: 'settings', optionalFeature: 'financial_health_score', slots: ['Wellness Score, Emergency Runway and Debt-to-Income', '6-Pillar Financial Health Scorecard and Advisory'] },
  { path: '/budgets', title: 'Budgets', icon: Wallet, settingsGroup: SETTINGS_GROUPS[3], defaultPlacement: 'settings', optionalFeature: 'budgets', slots: ['Monthly Envelope Cap, Utilized Burn and Remaining Buffer', 'Category Budget Envelopes and Threshold Progress'] },
  { path: '/savings-goals', title: 'Savings goals', icon: PiggyBank, settingsGroup: SETTINGS_GROUPS[3], defaultPlacement: 'settings', optionalFeature: 'savings_goals', slots: ['Active Sinking Funds, Total Saved and Monthly Auto-Earmark', 'Target Milestones and Projected Completion Dates'] },
  { path: '/calculators', title: 'Calculators', icon: Calculator, settingsGroup: SETTINGS_GROUPS[4], defaultPlacement: 'settings', optionalFeature: 'calculators', slots: ['Chitti Auction Bid and Loan EMI Arbitrage Simulator', 'Prepayment and Compounding Schedule Output'] },
  { path: '/shopping-lists', title: 'Shopping lists', icon: ShoppingBasket, settingsGroup: SETTINGS_GROUPS[4], defaultPlacement: 'settings', optionalFeature: 'shopping_lists', slots: ['Pre-Purchase Checklists and Estimated Cart Total', 'Safe-Leftover Impact and Convert-to-Ledger Preview'] },
  { path: '/notifications', title: 'Notifications', icon: Bell, settingsGroup: SETTINGS_GROUPS[0], defaultPlacement: 'settings', utility: true, slots: ['Pending approvals and confirmations', 'Actionable operational alerts'] },
  { path: '/settings', title: 'Settings', icon: Settings, settingsGroup: SETTINGS_GROUPS[0], defaultPlacement: 'navbar', slots: [] },
]

export const AUTH_ROUTE = {
  path: '/auth',
  title: 'Sign in',
  role: 'Public Route',
  slots: ['Centered Auth Card'],
} as const

export const AUTH_PATH = '/auth'
export const OPTIONAL_FEATURES: FeatureKey[] = ['budgets', 'calculators', 'savings_goals', 'shopping_lists', 'financial_health_score']
export const ROUTE_COMPONENT_LOADERS: Record<string, () => Promise<{ default: ComponentType }>> = {
  '/': () => import('../screens/Dashboard'),
  '/ledger': () => import('../screens/Ledger'),
  '/calendar': () => import('../screens/Calendar'),
  '/chittis': () => import('../screens/Chittis'),
  '/debts': () => import('../screens/Debts'),
  '/accounts': () => import('../screens/Accounts'),
  '/contacts': () => import('../screens/Contacts'),
  '/offline': () => import('../screens/OfflineQueue'),
  '/reports': () => import('../screens/Reports'),
  '/financial-health': () => import('../screens/FinancialHealthScore'),
  '/budgets': () => import('../screens/Budgets'),
  '/savings-goals': () => import('../screens/SavingsGoals'),
  '/calculators': () => import('../screens/Calculators'),
  '/shopping-lists': () => import('../screens/ShoppingLists'),
  '/settings': () => import('../screens/Settings'),
  '/notifications': () => import('../screens/Notifications'),
}

export function findRoute(path: string) {
  return ROUTE_REGISTRY.find(route => route.path === path)
}

export function getDefaultPlacement(route: RouteDefinition, isMobile: boolean) {
  return (isMobile && route.mobileDefaultPlacement) || route.defaultPlacement
}

export function getEffectivePlacement(route: RouteDefinition, placements: Record<string, RoutePlacement>, isMobile: boolean) {
  return placements[route.path] || getDefaultPlacement(route, isMobile)
}

export function getGroupedSettingsRoutes(placements: Record<string, RoutePlacement>, enabled: Partial<Record<FeatureKey, boolean>>, isMobile: boolean) {
  return SETTINGS_GROUPS.map(group => ({
    group,
    routes: ROUTE_REGISTRY.filter(route => !route.utility && route.path !== '/settings' && route.path !== '/' && route.settingsGroup === group && getEffectivePlacement(route, placements, isMobile) === 'settings' && (!route.optionalFeature || Boolean(enabled[route.optionalFeature]))),
  })).filter(section => section.routes.length > 0)
}
