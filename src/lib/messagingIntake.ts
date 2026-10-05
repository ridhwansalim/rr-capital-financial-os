import { registerPlugin } from '@capacitor/core'

export type ParsedMessageCandidate = {
  id: string
  amount: number
  direction: 'expense' | 'income'
  transactionType: 'debit' | 'credit'
  description: string
  bank: string
  accountSuffix: string
  source: 'sms' | 'notification'
  receivedAt: number
}

type MessagingIntakePlugin = {
  requestSmsPermissions(): Promise<{ granted: boolean }>
  checkSmsPermissions(): Promise<{ granted: boolean; enabled: boolean }>
  setSmsCaptureEnabled(options: { enabled: boolean }): Promise<void>
  openNotificationAccessSettings(): Promise<void>
  checkNotificationAccess(): Promise<{ granted: boolean; enabled: boolean }>
  setNotificationCaptureEnabled(options: { enabled: boolean }): Promise<void>
  requestNotificationPermission(): Promise<{ granted: boolean }>
  checkNotificationPermission(): Promise<{ granted: boolean; enabled: boolean }>
  setReviewNotificationsEnabled(options: { enabled: boolean }): Promise<void>
  getCandidates(): Promise<{ candidates: ParsedMessageCandidate[] }>
  dismissCandidate(options: { id: string }): Promise<void>
}

export const MessagingIntake = registerPlugin<MessagingIntakePlugin>('MessagingIntake')
