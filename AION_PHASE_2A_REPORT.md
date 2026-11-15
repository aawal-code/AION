# AION Phase 2A Report — Durable Identity & Authorization

## Result

Phase 2A introduces a transactional SQLite-backed identity store, Ed25519 device authentication, roles/capabilities, owner recovery-key rotation, and central protected-route authorization. Phase 1 containment remains: loopback-only HTTP, no CORS, and screen control, arbitrary CLI, remote access, and update installation remain disabled.

## Changed components

* `src/services/identity-store.js` — schema, audit ledger, device/key enrollment, challenge/session lifecycle, revocation, recovery.
* `src/services/auth.js`, `src/routes/auth.js`, `src/routes/router.js` — desktop bridge, key-auth endpoints, retired PIN enrollment, and capability guard.
* `docs/SECURITY_IDENTITY.md` — boundaries, roles, migration/backups, and limitations.
* `tests/phase2a-identity.test.js` — isolated store test.

## Verification

`node --test tests/phase1-containment.test.js tests/phase2a-identity.test.js` passed: 2 tests, 2 passed, 0 failed. Tests use temporary directories and no external network listener. They demonstrate anonymous rejection, desktop bootstrap, signed device identity, Trusted denial of workstation control, single-use challenge replay rejection, revocation, invalid recovery-key rejection, recovery-key rotation, and retained Phase 1 disablement.

The test suite is not proof of complete security. Native C# build/UI wiring and long-duration process benchmarks require a clean build and deployment validation. The Phase 1 idle benchmark remains the valid comparison baseline; Phase 2A adds no daemon/timer and performs cryptography only during enrollment/challenge/recovery. No new runtime measurement can be attributed until the updated build is deployed.

## Remaining blockers

* Native security-settings/enrollment/recovery UI is not yet implemented; APIs are available only for controlled integration/testing. This blocks a user-complete single-window identity workflow.
* Remote transport/device discovery remains intentionally disabled.
* API vault secrets still use the legacy vault and need a separate DPAPI/Windows Credential Manager migration.
* No durable approval model exists for re-enabling OS control, AI tasks, or screen control.
* The migration strategy intentionally leaves legacy JSON credentials untouched but does not automatically import them as trusted identities.

## Phase 2B recommendation

Build the in-app Owner/device enrollment and recovery flows, Windows protected-secret integration, approval/audit UI, and then authenticated encrypted transport. Do not restore remote-control capabilities before those gates exist.
