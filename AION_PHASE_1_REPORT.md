# AION Phase 1 Completion Report

**Date:** 2026-11-15
**Scope:** Security containment, resource-measurement foundation, and documentation asset foundation. No production deployment, dependency upgrade, user-data deletion, or release publication was performed.

## Completed containment

* Default listener changed from all interfaces to `127.0.0.1`; remote HTTP control is unavailable by default.
* Loopback address is no longer an owner authorization grant. The Windows shell creates a high-entropy startup secret, passes it only to its Node child, and uses it once to obtain an HttpOnly, `SameSite=Strict` local session cookie.
* Query-string bearer tokens were removed. CORS is disabled, and cross-origin requests are rejected.
* `/api/runner`, CLI execution routes, external AI CLI delegation, remote screen control/view, and update apply return explicit disabled responses pending safe replacements.
* The native host disables WebView2 DevTools, stops the native/launcher daemon-start race, and uses a non-authenticated root health probe so the auth change does not trigger duplicate hosts.
* Installer QR generation no longer sends pairing URLs to `api.qrserver.com`; remote pairing messaging now states the current security limitation.

## Tests

`node --test tests/phase1-containment.test.js` passed (1/1). It creates an isolated temporary working directory and verifies: unauthenticated runner rejection; desktop bootstrap session creation; runner/CLI/screen/update disablement; and URL-token rejection.

JavaScript syntax validation passed for the changed server, launcher, auth and route modules. The native C# build was not run because compiling the installer would overwrite build artifacts and may invoke external build prerequisites; its changed code requires a clean Windows build/launch verification before release.

## Resource baseline

`docs/benchmarks/phase1-idle-baseline.json` is a 10-second read-only capture of the already installed host, prior to deploying Phase 1. Measured averages/peaks:

| Component | Working set | Private bytes | CPU peak | Notes |
|---|---:|---:|---:|---|
| Node background host | 68.5 MB | 66.2 MB | 0% | Below the 100 MB host target in this short sample. |
| AION native shell | 51.4 MB | 33.4 MB | 0% | Separate process. |
| WebView2 browser process | 105.2 MB | 32.5 MB | 0% | Several additional WebView2 children existed. |
| Second Node process | 5.4 MB | 2.0 MB | 0% | Confirmed duplicate-host symptom; not removed from the live installation. |

The new `scripts/benchmark-host.ps1` captures process working set/private bytes, process CPU, and process disk I/O for idle, visible UI, and active-task scenarios. It does not start, stop, or reconfigure AION. The baseline is not a full performance certification: it does not establish active AI-worker use, P95 values, or disk totals across a longer test.

## Documentation foundation

Added `docs/assets/screenshots/`, `docs/assets/demos/`, an asset manifest, and a development-status page. The manifest expressly blocks fake screenshots, fabricated badges, and release README assembly until assets come from verified release-candidate flows.

## Remaining blockers / known regressions

* Remote mobile/mesh access is intentionally unavailable until authenticated encrypted transport and device identity exist.
* CLI task execution, remote screen control, and automatic update installation are intentionally unavailable.
* Browser-only source launches do not have the native bootstrap secret; use the native shell for normal local operation until a reviewed local IPC/developer workflow is implemented.
* The startup secret is supplied to the WebView2 bootstrap request and becomes the session cookie. A future owner/auth design should replace it with a short-lived, scoped local-session token and OS-protected broker/IPC.
* Existing JSON/SQLite state, weak vault key derivation, in-memory device queues, and unsigned update implementation remain architectural risks even though unsafe endpoints are disabled.
* The installed live copy was not rebuilt or restarted; benchmark observations represent the pre-containment runtime.

## Phase 2 recommendation

Build identity and transport before restoring remote features: OS-keystore-backed owner/device keys, capability grants, a scoped approval ledger, local IPC/browser-session broker, mTLS or an authenticated encrypted mesh transport, CSRF policy, and a signed/rollback-capable update pipeline. Do not re-enable task execution or screen control first.
