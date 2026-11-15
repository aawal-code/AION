# AION Phase 2A — Security Completion Status

## Status: not complete

This branch hardens the available identity foundation and adds a real in-window security surface. It is not a production release and it does not meet every Phase 2A completion gate. A clean native build and a partial ten-minute source-host measurement were completed; native-window/UI validation remains blocked.

## Native build and integration evidence

* Built in the isolated directory `C:\aion-phase2a-build`; the source checkout and installed AION location were not used as build outputs.
* The dependency fetcher now pins Microsoft.Web.WebView2 `1.0.2903.40` to the official NuGet catalog SHA-512 `pDLSrpyma3xyOGXlw3Aowy7XceBdeJbukZzKLVdPCFvyfnn8PrCLylMn6c456ja0TcOOal8IdQCVONDRU2OGkw==` before extraction.
* The build produced `AION.exe` (48,128 bytes), `Uninstall.exe` (46,592 bytes), and `AION-Setup.exe` (1,343,488 bytes). The .NET Framework C# compiler emitted no source warning/error; it printed its standard C# 5 support notice.
* The native shell now supports `AION_PORT` and `AION_INSTANCE_ID` overrides for isolated test installations while preserving default port and single-instance behavior.
* Native-window launch was not completed: the installed AION owns port 5050, and the available automation/process-control surface rejected launch of the isolated executable with its test environment. Therefore enrollment/recovery UI clicks, close/reopen behavior, duplicate-host observation, WebView2 child attribution, and absence of native dialogs are **not verified**.

## DPAPI migration evidence

`tests/vault-dpapi-migration.test.js` passes with a synthetic deterministic legacy vault under the current Windows user. It verifies successful read/migration, atomic DPAPI rewrite, preservation of `vault.legacy.enc`, restart readback, and corrupted-vault fail-closed behavior without overwrite. Interrupted writes, a different Windows-user context, unavailable DPAPI, and WebView2-profile loss cannot be safely reproduced in this user session and remain unverified.

## Resource policy and benchmark

The default persisted policy is **Balanced**. Eco, Balanced, and Performance change the host laptop/power hardware probe to 60, 30, and 15 seconds respectively. Authorization, recovery, DPAPI, and SQLite work remain event-driven; no mode starts a new daemon or changes security/file-integrity behavior.

After startup stabilization, an isolated Node host on `127.0.0.1:5505` was sampled at one-second intervals for 600 seconds:

| Measurement | Median | P95 | Peak |
|---|---:|---:|---:|
| Node working set | 66.7 MB | 66.9 MB | 66.9 MB |
| Node CPU | 0% | 0% | 0% |
| Node threads | 14 | 15 | 15 |

Windows did not expose process I/O counters for this sample, so disk I/O is not reported. Native shell and WebView2 were not launchable through the available test-control surface and are not included. This is a partial host benchmark, not an end-to-end desktop performance certification.

## Implemented on `feature/identity-security-completion`

* A SQLite-backed, schema-versioned identity store persists Ed25519 public identities, capability roles, hashed short-lived sessions, one-time challenges, hashed recovery verifiers, bootstrap-session hashes, and audit records.
* The native WebView2 secret now creates only a five-minute, scoped bootstrap session. It no longer acts as an Owner credential or general API token.
* Initial Owner enrollment requires the bootstrap session and a same-origin CSRF token. The browser creates an Ed25519 key pair and stores its non-extractable private key in its WebView2 browser profile; the server stores only the public key.
* Owner sessions are created only after an Ed25519 challenge response. Session cookies are HttpOnly and SameSite=Strict; their raw tokens are not exposed to JavaScript or accepted in URLs.
* Same-origin and CSRF validation protect state-changing API requests. Challenge creation/authentication are the narrowly scoped pre-session exceptions; replay is rejected transactionally.
* Owner-only operations now include device enrollment, device revocation, session revocation, recovery-key rotation, and security-audit viewing.
* Owner-side device pairing now uses five-minute, locally generated QR invitations, one-time Ed25519 public-key claims, matching-code verification, explicit Owner approval, transactional grants, and audit records. The invitation QR contains an identifier only, never a session credential.
* The Settings window includes a Security tab with initial enrollment, recovery, one-time recovery-key acknowledgement/copy, device roles, revocation, active sessions, and audit history. Controls call live APIs; no synthetic success state is used.
* The API-key vault no longer stores credentials in browser localStorage. On Windows it uses DPAPI CurrentUser protection through a short-lived, hidden PowerShell invocation, with atomic write and legacy-vault backup before migration. Non-Windows production execution fails closed; a test-only key is permitted solely for isolated test fixtures.

## Verification performed

* `node --check` passed for the modified identity, auth, router, vault, settings, and security modules.
* `node --test tests/phase1-containment.test.js tests/phase2a-identity.test.js tests/security-auth-contract.test.js` passed (3 tests, 0 failures).
* `node --test tests/config-execution-target.test.js tests/resource-policy.test.js tests/vault-dpapi-migration.test.js` passed (11 tests, 0 failures).
* `node --test tests/frontend-static.test.js tests/milestone4-ui.test.js tests/security-auth-contract.test.js` passed (30 tests, 0 failures).
* The HTTP security-contract test uses a temporary SQLite database and server. It demonstrates anonymous-loopback denial, foreign-origin denial, bootstrap-secret verification, CSRF rejection, owner enrollment, signed-session creation, recovery-key rotation, and challenge-replay rejection.
* A staged-file privacy-pattern scan found no common API-token or private-key patterns. This is not proof that no secret can exist.

## Security boundaries retained

Phase 1 remains in force: the host binds to loopback by default; arbitrary shell/CLI execution, remote screen control/capture, plaintext remote access, and update application remain disabled. Network location, loopback, Tailscale membership, and a device name do not confer Owner authority.

## Known limits and blockers

* The clean native Windows build succeeds, but native launch/UI testing remains blocked as described above.
* The ten-minute measurement covers only the isolated Node host; it does not satisfy the required native/WebView2 process-tree benchmark.
* The security UI is presently English-only. The existing settings UI itself contains untranslated strings, so Arabic RTL and German verification remain incomplete.
* Browser-key recovery depends on the WebView2 profile retaining the non-extractable key. The recovery key restores ownership but not application/project data; a documented profile-backup and Windows-user migration procedure remains needed.
* DPAPI behavior has not been integration-tested against an installed Windows package. Legacy migration is covered by code review and atomic-write design, not an installed-user-data migration rehearsal.
* Legacy non-security tests that expect unauthenticated HTTP success or generated installer binaries remain incompatible with Phase 1 containment and source-only publication. They must be rewritten around signed sessions and a clean build artifact pipeline rather than used to weaken authentication.
* Pairing is an enrollment foundation, not remote connectivity: a device-side scanner/client and authenticated encrypted multi-host transport remain required before any cross-host use can be claimed.

## Publication

Commits are pushed to the development branch. A draft pull request must remain unmerged until the blockers above, platform verification, localization, and sustained performance measurements are resolved.
