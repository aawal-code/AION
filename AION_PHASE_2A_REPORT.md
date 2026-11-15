# AION Phase 2A — Security Completion Status

## Status: not complete

This branch hardens the available identity foundation and adds a real in-window security surface. It is not a production release and it does not meet every Phase 2A completion gate. In particular, an isolated native Windows build/launch validation and the required sustained 10-minute performance capture have not been completed.

## Implemented on `feature/identity-security-completion`

* A SQLite-backed, schema-versioned identity store persists Ed25519 public identities, capability roles, hashed short-lived sessions, one-time challenges, hashed recovery verifiers, bootstrap-session hashes, and audit records.
* The native WebView2 secret now creates only a five-minute, scoped bootstrap session. It no longer acts as an Owner credential or general API token.
* Initial Owner enrollment requires the bootstrap session and a same-origin CSRF token. The browser creates an Ed25519 key pair and stores its non-extractable private key in its WebView2 browser profile; the server stores only the public key.
* Owner sessions are created only after an Ed25519 challenge response. Session cookies are HttpOnly and SameSite=Strict; their raw tokens are not exposed to JavaScript or accepted in URLs.
* Same-origin and CSRF validation protect state-changing API requests. Challenge creation/authentication are the narrowly scoped pre-session exceptions; replay is rejected transactionally.
* Owner-only operations now include device enrollment, device revocation, session revocation, recovery-key rotation, and security-audit viewing.
* The Settings window includes a Security tab with initial enrollment, recovery, one-time recovery-key acknowledgement/copy, device roles, revocation, active sessions, and audit history. Controls call live APIs; no synthetic success state is used.
* The API-key vault no longer stores credentials in browser localStorage. On Windows it uses DPAPI CurrentUser protection through a short-lived, hidden PowerShell invocation, with atomic write and legacy-vault backup before migration. Non-Windows production execution fails closed; a test-only key is permitted solely for isolated test fixtures.

## Verification performed

* `node --check` passed for the modified identity, auth, router, vault, settings, and security modules.
* `node --test tests/phase1-containment.test.js tests/phase2a-identity.test.js tests/security-auth-contract.test.js` passed (3 tests, 0 failures).
* `node --test tests/frontend-static.test.js tests/milestone4-ui.test.js tests/security-auth-contract.test.js` passed (30 tests, 0 failures).
* The HTTP security-contract test uses a temporary SQLite database and server. It demonstrates anonymous-loopback denial, foreign-origin denial, bootstrap-secret verification, CSRF rejection, owner enrollment, signed-session creation, recovery-key rotation, and challenge-replay rejection.
* A staged-file privacy-pattern scan found no common API-token or private-key patterns. This is not proof that no secret can exist.

## Security boundaries retained

Phase 1 remains in force: the host binds to loopback by default; arbitrary shell/CLI execution, remote screen control/capture, plaintext remote access, and update application remain disabled. Network location, loopback, Tailscale membership, and a device name do not confer Owner authority.

## Known limits and blockers

* A clean Windows native build cannot currently run because the checked-out build environment lacks the verified WebView2 assemblies. The build script may fetch prerequisites, so it was not used as an unverified downloader. No isolated WebView2 enrollment/recovery startup test was performed.
* The required ten-minute process-tree benchmark was not run. The Phase 1 10-second baseline is historical only and cannot certify this branch. No performance figures are claimed.
* The security UI is presently English-only. The existing settings UI itself contains untranslated strings, so Arabic RTL and German verification remain incomplete.
* Browser-key recovery depends on the WebView2 profile retaining the non-extractable key. The recovery key restores ownership but not application/project data; a documented profile-backup and Windows-user migration procedure remains needed.
* DPAPI behavior has not been integration-tested against an installed Windows package. Legacy migration is covered by code review and atomic-write design, not an installed-user-data migration rehearsal.
* Legacy non-security tests that expect unauthenticated HTTP success or generated installer binaries remain incompatible with Phase 1 containment and source-only publication. They must be rewritten around signed sessions and a clean build artifact pipeline rather than used to weaken authentication.

## Publication

Commits are pushed to the development branch. A draft pull request must remain unmerged until the blockers above, platform verification, localization, and sustained performance measurements are resolved.
