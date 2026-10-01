# App auto-lock behavior and limits

The auto-lock is a local privacy barrier for a signed-in browser session. Supabase authentication, row-level security, and the financial RPCs remain the security boundary for stored financial data. The screen lock does not encrypt data already loaded into the browser and must not be treated as protection against a compromised device, browser profile, or injected script.

The optional four-digit PIN is stored as a random-salted PBKDF2-SHA-256 verifier (310,000 iterations), not as readable text. Older installs migrate the previous local PIN into this verifier and remove the plaintext value. Failed attempts trigger an increasing retry delay after five failures. These values live in browser storage, so someone with control of the browser profile can alter or remove them; the four-digit PIN is for casual privacy, not strong authentication.

When device screen-lock authentication is enabled, the PWA requests a platform WebAuthn credential with user verification required. Before dismissing the lock screen, the client checks the returned credential against the registered credential ID, current challenge, origin, relying-party ID hash, and user-verification flags. The app does not store a public key and does not cryptographically verify the assertion signature with a trusted server. Therefore, this also remains a local privacy barrier and depends on the browser/OS authenticator in the normal untampered app context.

## Verify changes

1. In Settings, set a four-digit PIN and confirm the input clears while the “PIN is set” status remains.
2. Enable auto-lock with a PIN, or with a saved device authenticator. The Profile shortcut applies the same requirement.
3. Set the lock timeout to one minute, wait for the lock screen, unlock with the correct PIN, and confirm an incorrect PIN is rejected. After five failed attempts, confirm retries are temporarily delayed.
4. If an older local PIN exists, start the app and confirm `financial_os_pin` is removed and `financial_os_pin_hash` is created.
5. On a device with a previously registered platform credential, confirm its screen-lock prompt unlocks the app. Browser/device WebAuthn end-to-end testing is required for this last step; the local automated smoke check does not emulate a platform authenticator.
