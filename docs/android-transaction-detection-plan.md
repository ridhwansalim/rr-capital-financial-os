# RR Capital Android transaction detection plan

## Product decision

Keep the responsive PWA as the single product UI and package that same app as a privately distributed Android APK with Capacitor when native work starts. A standalone companion would duplicate accounts, category, inbox, and reporting flows. The current PWA cannot receive SMS broadcasts or read other apps' notifications; browser permissions do not expose either Android API. Distribution is for the user, family, and friends; public Play Store release is out of scope.

## Sources and policy boundary

- Android `BroadcastReceiver` can receive `SMS_RECEIVED` only in a native app with `RECEIVE_SMS`. Android marks this permission hard-restricted: the installer must allowlist it, and the user cannot allowlist it manually. Private sideloading therefore does not guarantee SMS access. Test the chosen installer on the target phones before depending on this source; fall back to notification detection when it is unavailable. ([Android SMS intents](https://developer.android.com/reference/android/provider/Telephony.Sms.Intents), [Android permission reference](https://developer.android.com/reference/android/Manifest.permission#RECEIVE_SMS), [Android hard-restricted permission behavior](https://source.android.com/docs/core/permissions/runtime_perms))
- `NotificationListenerService` is a native Android service. The user must explicitly enable notification access in Android Settings. Request it only after an opt-in explanation and app selection. Parse only notifications from chosen financial apps. ([Android API reference](https://developer.android.com/reference/android/service/notification/NotificationListenerService))
- The PWA can generate report files and invoke Android's share sheet through the Web Share API in supported secure-context browsers. Keep a download fallback when file sharing is unavailable. ([MDN Web Share API](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/share))

## Architecture

1. Add Capacitor Android packaging around the existing Vite build. Preserve Supabase Auth, RLS, transaction RPCs, routes, themes, offline outbox, and layouts; do not fork a second feature implementation.
2. Add one Kotlin `TransactionDetectionPlugin` that owns an explicit opt-in setting, selected sender/package allowlist, and a shared `TransactionRegexParser`. Both `SMS_RECEIVED` and `NotificationListenerService` send candidate text into that parser. Keep parsing and raw source text on-device; do not upload message bodies or notification contents.
3. Normalize matches to a minimal candidate: source kind, amount, direction, merchant/payee, currency, date, and a local deduplication key. Never post a ledger transaction automatically. Require the user to choose an account, confirm the amount/date, and assign a category.
4. Store candidates in a local pending inbox that survives app restarts and is separate from the ledger/outbox. Ignore duplicates using a hash of normalized sender/package, reference number when available, amount, direction, and date. Keep raw message/notification content only long enough to parse it; discard it immediately after candidate creation.
5. Publish one ongoing Android notification per pending candidate with an opaque label and an “Open pending item” action. Do not put amounts, balances, payees, or message text on the lock screen. Categorizing and confirming creates one idempotent ledger outbox item, then removes that candidate and cancels its notification. Discarding removes the candidate and cancels the notification. If Android or the user removes a notification, restore it from the still-pending local record.
6. Expose only narrow bridge methods to React: capability/permission status, opt-in changes, pending-candidate list, candidate confirmation, discard, and subscription updates. Reuse the existing ledger posting RPC and offline queue after confirmation.

## Permissions and failure behavior

- Ask for detection opt-in separately for SMS and notification access. Explain exact sources, on-device parsing, retained fields, and how to turn it off before sending users to Android settings.
- Default both sources off. Offer manual transaction entry if access is refused, revoked, or the device lacks the service.
- Android notification permission (where required by OS version) controls visible notifications. Keep the pending inbox authoritative if notification permission is denied; show an in-app pending count.
- `setOngoing(true)` makes app notifications persistent in normal user interaction, but Android/system actions can still remove them. Reconcile posted notifications from the local pending store at service/app start; do not promise an unremovable system notification.
- Parsing is heuristic. Never infer a category or post a transaction without user review. A malformed/ambiguous message should produce no candidate.

## Delivery gates

1. Confirm an Android SDK/build-tools environment and add Capacitor with a locked Android Gradle version.
2. Implement and unit-test the parser with anonymized bank/UPI fixtures, including credits, debits, reversals, masked cards, duplicate alerts, localized number formats, and ambiguous cases.
3. Test permission denial/revocation, Android process death, duplicate broadcasts, reboot, lock-screen privacy, notification reconciliation, offline confirmation/retry, and exactly-once ledger posting on physical Android devices.
4. Privately distribute a signed APK to the intended devices. Check SMS permission allowlisting during install on every target Android version; no Play Console submission is planned. If the installer cannot allowlist SMS, leave SMS detection off and use the notification-listener source. Keep Supabase authorization unchanged.
5. Verify the packaged PWA reports, file-share flow, and all existing ledger/chitti/debt flows before release.

## Current status

The web app remains the supported PWA. No Android permissions or native background services have been added yet. Private APK packaging still needs Android Studio/SDK, an installable signing setup, and tests on the target devices. Notification access requires the user's Android Settings consent. SMS detection additionally depends on whether the installer can allowlist Android's hard-restricted permission.
