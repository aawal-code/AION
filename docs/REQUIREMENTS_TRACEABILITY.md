# AION requirements traceability

**Source:** [`AION_MASTER_SPEC.md`](AION_MASTER_SPEC.md), revision 2026-11-15.
**Audit date:** 2026-11-15.
**Method:** statuses below are based on current source, committed tests, and the Phase 2A report—not on UI text, old test names, or the specification itself. “Implemented” means a limited, evidenced part of the stated requirement, not that the broader product area is complete.

| Spec | Requirement | Status | Evidence | Test evidence / qualification |
|---|---|---|---|---|
| 0 | Local-first modular Windows desktop host with Node, WebView2, SQLite, and no cloud dependency | Partial | `src/server.js`, `scripts/win/AionApp.cs`, `src/services/identity-store.js` | `tests/architecture.test.js`; only loopback source-host/native build evidence exists. |
| 0 | One-window UX, no surprise browser/terminal windows | Partial | `scripts/win/AionApp.cs`, `public/index.html` | Native build completed; native launch/lifecycle is unverified: `AION_PHASE_2A_REPORT.md`. |
| 0 | Economical process tree and measured idle behavior | Partial | `src/services/telemetry.js`, `scripts/benchmark-host.ps1` | 600-second Node-only benchmark in Phase 2A report; WebView2/native/I/O measurements are missing. |
| 0 | Adaptive Resource Governor affecting scheduling, concurrency, I/O, and power/network work | Partial | `src/services/config.js`, `src/services/telemetry.js`, `src/routes/config.js` | `tests/resource-policy.test.js`; modes currently alter only the unref'd hardware-probe cadence, explicitly insufficient for full requirement. |
| 0, 2 | Host-enforced security; no implicit loopback/Tailscale authority | Partial | `src/routes/router.js`, `src/routes/auth.js`, `src/services/identity-store.js` | `tests/phase1-containment.test.js`, `tests/security-auth-contract.test.js`, `tests/phase2a-identity.test.js`; remote encrypted transport is absent. |
| 0, 11 | Transactional durable state, bounded logs/queues, safe recovery | Partial | `src/services/identity-store.js`, `src/services/assistant-db.js`, `src/services/devices.js` | Identity state is SQLite/WAL transactional. Other state remains JSON/in-memory and lacks crash/reconciliation guarantees. |
| 1 | Independent multi-host topology and per-host state | Missing | Local data paths exist under `data/` | No authenticated host-to-host protocol or host mapping. |
| 1 | Invisible sign-in start, tray Open/Pause/Resume/Sync/Quit, optional autostart | Partial | `scripts/win/AionApp.cs`, `scripts/win/setup.ps1` | Native UI/lifecycle not validated; tray/pause/resume semantics are not evidenced. |
| 1, 2, 7 | LAN/Tailscale-capable encrypted AION transport, approved device pairing, and durable replication delivery | Partial | `src/services/host-transport.js`, `src/services/transport-identity.js`, `src/services/identity-store.js`, `src/services/replication-store.js` | `tests/host-transport.integration.test.js` spawns two independent Windows-host processes with isolated SQLite/DPAPI state and exchanges project-metadata events over real loopback TCP/TLS 1.3. It verifies mTLS pinning, exporter-bound Ed25519 authentication, capability/revocation enforcement, transactional acknowledgement, reverse delivery, retained same-revision conflict events, and queued-work delivery after a sender process restart. LAN/Tailscale discovery, reconnect scheduler, file/content sync and conflict UI remain unimplemented. |
| 1 | Responsive mobile PWA with safe offline editing and explicit host selection | Partial | `public/manifest.json`, `public/sw.js`, `public/js/app.js` | PWA shell exists; legacy pairing UI is not secure/functional under containment, and offline edit/host-selection rules are absent. |
| 1 | Accurate device state vocabulary | Missing | `src/services/devices.js` has transient telemetry | No durable online/connecting/offline/paused/unavailable/stale state model. |
| 2 | Owner/Trusted/Limited roles and central capability checks | Partial | `src/services/identity-store.js`, `src/routes/router.js` | `tests/phase2a-identity.test.js`, `tests/security-auth-contract.test.js`; role ceilings and explicit persisted device grants are enforced, but granular administration UI and all future operation mappings are incomplete. |
| 2 | Owner-approved QR + matching-code pairing with signed challenges | Partial | `src/services/identity-store.js`, `src/routes/auth.js`, `public/js/security.js`, `public/js/qr.js` | `tests/phase2a-identity.test.js`, `tests/security-auth-contract.test.js`; local QR invitation, one-time claim, matching-code approval, Ed25519 enrollment, and certificate-pin binding work. Reachable encrypted host transport and device-side scanner flow remain missing. |
| 2 | Owner recovery key, rotation, local verification, no project-data recovery | Partial | `src/services/identity-store.js`, `docs/SECURITY_IDENTITY.md` | `tests/phase2a-identity.test.js`; profile-loss and actual native local-access validation remain unverified. |
| 2 | DPAPI protected secrets, safe legacy migration and Windows-user/profile threat model | Partial | `src/services/vault.js`, `tests/vault-dpapi-migration.test.js` | Synthetic CurrentUser migration and corrupt-vault fail-closed cases pass; interruption, user-context, installed-data, and profile-loss tests are missing. |
| 2, 10 | Revocation/high-impact approval/audit controls | Partial | `src/services/identity-store.js`, `public/js/security.js` | Revocation and audit are tested. High-impact operations are contained/disabled, not approval-backed. |
| 3 | Four primary destinations and stated secondary destinations | Partial | `public/index.html`, `public/js/nav.js` | Existing home/chat/devices/settings UI; tasks, automations, folders, skills, approvals, and backups are incomplete or absent. |
| 3 | Sidebar behavior, dual Home composers, explicit device target | Partial | `public/index.html`, `public/js/app.js` | Existing UI has related controls; no acceptance test proves all specified persistence/selection behavior. |
| 3 | Chat modes, providers, context inspector, searchable conversations | Partial | `src/routes/assistant.js`, `src/services/assistant-db.js`, `public/js/assistant.js` | Conversation/project storage exists. Execute is disabled; provider routing/context inspector/search are incomplete. |
| 3 | Accessible panels, approvals inbox, themes/density | Partial | `public/css/tokens.css`, `public/css/app.css`, `public/index.html` | Theme/i18n static tests exist; no complete keyboard/screen-reader or approvals implementation. |
| 3 | Reviewed English, Arabic RTL, German catalog and locale-aware formatting | Partial | `public/js/i18n.js`, `public/css/app.css` | `tests/frontend-static.test.js`; settings/security strings remain untranslated and no visual/a11y validation exists. |
| 4 | Authorized global search and command palette | Missing | No search-index or command-palette service | No authorization-bound result model. |
| 4 | Metadata indexing plus opt-in, bounded full-content indexing | Missing | No index service | No tests. |
| 5 | Linked multi-folder projects, exclusion rules, per-host mapping | Partial | `src/services/assistant-db.js`, `src/routes/assistant.js` | A single project path is stored; safe linking, multiple folders, excludes, and host mapping are missing. |
| 5 | Durable chat memory, provenance, context inspector | Partial | `src/services/assistant-db.js`, `src/routes/assistant.js` | Conversations/messages persist; shared memory/provenance/inspector and move confirmation are missing. |
| 5 | Provider adapters, local credentials, budgets/routing | Partial | `src/services/vault.js`, `src/routes/assistant.js` | Vault/provider configuration exists; external CLI execution is intentionally disabled, and discovery/routing/budgets are missing. |
| 6 | Backend-enforced Ask/Plan/Execute with scoped approvals | Partial | `src/routes/assistant.js`, `src/routes/commands.js` | Ask persistence exists; execute/runner intentionally returns disabled. No approval engine. |
| 6 | Durable task model, selected host, restart-safe execution | Missing | No task-orchestrator persistence | No task/reconciliation tests. |
| 6 | Parallel-agent coordination and validated integration | Missing | No worker isolation or coordination service | No tests. |
| 7 | Secure all-host two-way sync with durable manifests/conflicts/retention | Partial | `src/services/replication-store.js` | `tests/replication-store.test.js`; local event identities, acknowledgements, idempotency, and revision conflicts persist transactionally. No transport, file transfer, tombstones, or retention workflow exists. |
| 7 | Five-minute/event-driven sync and safe file exclusions/indexing separation | Missing | Legacy UI routes only | No tests; must not be inferred from Syncthing status UI. |
| 8 | Declarative, approved, durable automations | Missing | No automation engine | No tests. |
| 9 | Weekly verified backups and guided non-destructive restore | Missing | No backup service | No tests. |
| 9 | Verified staged updates with rollback | Missing | `src/services/updater.js`, `src/routes/router.js` | Apply endpoint is intentionally disabled; no signed artifact/rollback flow. |
| 9 | In-window progressive onboarding | Partial | `public/js/security.js`, `public/index.html` | Security enrollment UI exists; full host/join/tool/Tailscale/PWA onboarding is missing and native validation is blocked. |
| 10 | Device detail with explicit host and accurate capabilities | Partial | `src/services/devices.js`, `public/js/devices.js` | Device UI exists; it is not a multi-host secure control plane. |
| 10 | Consent-bound screen control and remote OS actions | Blocked | `src/routes/router.js` | `tests/phase1-containment.test.js`; correctly disabled pending an approved design and secure transport. |
| 10 | Limited Wake-on-LAN claims | Partial | `src/services/wol.js`, `src/routes/router.js` | Existing tests cover local detection; remote internet guarantees are not made. |
| 11 | Required modular-monolith conceptual boundaries | Partial | `src/` services/routes | Identity/local API/desktop shell exist; approval, tasks, sync, automations, search, backups and PWA-client boundary are absent. |
| 11 | SQLite transactional schemas and authorized structured replication | Partial | `src/services/identity-store.js`, `src/services/assistant-db.js`, `src/services/replication-store.js` | Identity and replication ledgers use schema-versioned SQLite/WAL transactions; authorization-bound exchange transport is still absent. |
| 11 | Redacted, bounded logging and event-driven resource budgets | Partial | `src/services/sse.js`, `src/services/telemetry.js` | No formal redaction/retention policy or bounded resource scheduler. |
| 13 | Accurate README/status/assets/license/release gates | Partial | `README.md`, `docs/assets/ASSET_MANIFEST.md` | Status is conservative, but README is not yet the specified product-first release README and no OSI license is selected. |
| 13–14 | Tested, privacy-scanned Conventional Commit workflow and source-of-truth policy | Implemented | `AGENTS.md`, `docs/AION_MASTER_SPEC.md`, `.gitignore` | Process files added in this milestone; ongoing adherence is required. |

## Priority order derived from the audit

1. Preserve containment and remove or clearly mark legacy pre-containment pairing/sync affordances that imply remote operation.
2. Finish the identity boundary: explicit per-device capability grants, secure pairing protocol design, complete migration/error tests, and native desktop verification.
3. Establish durable project/task/approval state before any execution capability; retain disabled execution until those gates exist.
4. Build secure replication, then backups and updates, before exposing remote or file-sync claims.
5. Add search/indexing, automations, broader localization/accessibility, and complete process-tree performance measurements as their dependencies become real.

## Known documentation conflict resolved by this matrix

`docs/SECURITY_IDENTITY.md` previously said DPAPI vault work was future work, while the current `src/services/vault.js`, tests, and Phase 2A report show a synthetic DPAPI migration implementation. The security document must be updated in the same milestone; synthetic coverage does not establish installed-data or cross-user migration success.
