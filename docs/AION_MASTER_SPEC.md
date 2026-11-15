# AION — Product & Engineering Master Specification

**Status:** Product decisions agreed; implementation status must always be determined from code, tests, and current reports.  
**Revision:** 2026-11-15  
**Authority:** This specification records intended product behavior, not proof that a feature exists. Security requirements and verified test evidence take precedence over optimistic status claims.

## 0. Non-negotiable product principles

- AION is a **local-first, open-source personal AI, device-control, file-sync, and productivity workspace** for ordinary users, not just developers.
- Windows desktop host: background Node.js service, Windows C# WebView2 shell, local SQLite; browser/mobile PWA clients. Prefer evolving a **modular monolith**; do not introduce heavyweight frameworks, resident daemons, or cloud dependencies without evidence.
- **One-window UX:** normal onboarding, chat, approvals, settings, pairing, tasks, error handling, sync conflicts, recovery, updates, and diagnostics must stay inside AION. No random command windows, browser tabs, popups, or additional GUI apps. Explicit, necessary OS-native prompts/file pickers and intentionally requested notifications are exceptions. Background CLI processes must be hidden.
- **Extremely economical resources:** quiet idle state (ideally <100 MB for background Node host), near-zero idle CPU, minimal disk writes, bounded memory/log/index/cache growth. Measure complete AION process tree including WebView2 and spawned AI tools, attributed separately. Higher consumption is legitimate only for useful active work; powerful hardware is not an excuse to waste resources. Targets require benchmark proof, not marketing claims.
- Automatically adaptive Resource Governor: **Balanced default**, optional **Eco** and **Performance** in Advanced Settings. Modes must govern actual job scheduling, concurrency, I/O and power/network behavior, not merely cosmetic settings or hardware polling frequency. No security/data-integrity weakening. Performance mode still idle-efficient.
- **Security is host enforced**, not delegated to AI prompting or UI; least privilege and explicit scope, strong pairing, protected credentials, encrypted authenticated remote traffic, no implicit trust from loopback or Tailscale membership. No unbounded arbitrary remote shell.
- Reliability: versioned transactional state, durable jobs, idempotency/reconciliation, conflict preservation, careful recovery, no silent data loss or fake successful actions. Avoid claiming “100% foolproof.”
- Existing code is untrusted until independently audited. Keep proven working foundations, replace unsafe ones. **Active repo:** `C:\aion-public-source`; **archived original:** `C:\aion` — do not edit/delete original. Public GitHub: `aawal-code/AION`.

## 1. Platform, topology, startup, connectivity

- Multiple **independent trusted Windows hosts** can be located in different places. Each is an AION host, with its own local database, local secrets, and host-specific working-folder paths. No AION-operated central cloud/account required.
- Windows host starts when its user **signs in**, invisibly in background. Not a before-login service. Closing the window does not stop host. Tray controls: Open, Pause/Resume, Sync Now, Quit. Optional disable auto-start.
- Local LAN connection preferred; optional Tailscale enables remote access worldwide. Tailscale is transport/discovery, **not authorization**; encrypted authenticated AION connection required. Relay fallback may occur. Do not assume router Wake-on-LAN capability.
- Mobile first release is a responsive **iOS/Android PWA**; no native app requirement. Can connect to reachable trusted hosts, choose execution target explicitly, and queue certain low-risk offline edits. No AI/device execution while all hosts are unreachable. Do not store provider secrets in PWA. Explain iOS/PWA cache eviction limitations.
- Device states must accurately distinguish online, connecting, offline, paused, unavailable and stale metadata. No fake online status.

## 2. Identity, pairing and permissions

- Roles **Owner, Trusted, Limited**, with capability grants enforced centrally at every route and operation. Multiple Owners are possible only by explicit Owner authorization.
- Pairing via short-lived QR and matching code, with explicit Owner approval. Device identity uses strong asymmetric keys / signed challenges; prevent replay, CSRF, fixation, origin bypass and revoked credentials. URL-based bearer secrets prohibited. Localhost alone never grants Owner.
- Generate a high-entropy **local Owner recovery key** during initial enrollment; require verified local access to an existing installation for recovery; rotate/revoke safely. This restores authorization only, not lost project data. Never log/copy credentials into plain sync.
- Secrets local per host, protected by Windows DPAPI or applicable OS secure store. Migrations from legacy secrets must preserve old data and fail closed. Explicit threat model for WebView2 non-extractable key/profile loss and Windows user changes.
- Immediate revocation for reachable devices; recognize that an offline revoked device cannot be retroactively wiped or informed until reconnecting.
- High-impact actions (screen viewing/control, OS power, file changes, task execution) require scoped authorization and appropriate UI approvals/audit entries.

## 3. Main UI / design system

- Premium, coherent, accessible, simple-by-default design with progressive disclosure. Real functional controls, loading/offline/empty/error states, consistent design tokens; no fake data/progress.
- Four primary destinations: **Home, Chat, My Devices, Settings**. Secondary destinations include Projects, Tasks + Automations, Synced Folders, Skills, Notifications/Approval Inbox, Backups.
- Desktop sidebar **expanded by default on wide screens**, manually icon-only or hidden, visibility remembered **per device**; no unexpected per-workspace collapse. Opening/closing never resets current context.
- Home has **two distinct actions/composers**: Ask AI and Control a Device. Device-control target must be explicitly visible/selected, never silently inferred.
- Chat UX: Ask / Plan(read-only) / Execute, provider/model selection, context inspector, skills; searchable conversations, project navigation, preserve source/reference context.
- Desktop contextual panels for Chat, Projects, Tasks, Automations, Devices, Synced Folders; mobile full-screen detail/bottom sheet and stable bottom navigation to four primary destinations. Keyboard and screen reader accessible.
- Persistent approvals inbox; routine approvals inline/contextual, critical prompts prominent but do not unnecessarily block unrelated work. Native notifications can alert but substantive interaction opens in AION.
- Themes: fully compatible Light/Dark plus curated polished themes and optional accent override with validated contrast; semantic tokens across dialogs, terminal, diffs, charts, focus, error and disabled states. No unrestricted editor for Beta 1. Density: Comfortable default, Compact and Spacious options, touch accessibility on mobile.
- Localization: bundled and reviewed **English, Arabic full RTL, German**, with locale-aware dates/numbers/plurals, proper LTR treatment of paths/code. More languages via versioned downloadable, validated, cached language packs and fallback. Canonical string catalog; no unreviewed claims of universal translation quality.

## 4. Global Search and command palette

- One global Search accessible in desktop header, keyboard shortcut (e.g. Ctrl+K), and mobile UI. Search authorized **conversations, projects, tasks, automations, skills, devices, indexed files**, with contextual filters (type, project, host, date). Result opens actual message/task/file/action and labels stale or offline sources.
- Automatically index only **authorized filenames and basic metadata** for eligible folders. Full-content indexing is **opt-in per project or folder**, with size/resource limits, exclusions, incremental updates, private/local indexes and permission-bound query and open. No silent uploading file contents to AI providers.
- Integrated keyboard command palette for navigation and safe authorized actions, **never bypassing normal approval**, target selection or permissions.

## 5. Projects, chat memory, skills and context

- Create new projects OR **link existing local folders in place**, without moving/changing their contents. **Multiple independently configured linked working folders per project**. Per-host local paths may differ; project shares chat, memory, tasks and skills. Allow excludes per folder/host; default safety exclusions for secrets, `.env`, `.git`, databases, dependencies and caches, with reviewed user customization.
- Conversations retain complete independent histories; relevant project memory may be shared across threads with source provenance, contradiction detection and explicit context boundaries. Moving a chat between projects changes accessible project memory and must request confirmation.
- Mastery of context: exact **Context Inspector** reveals assembled prompt/context, sources, tools and routing rationale as exposed by supported providers; protect secrets and avoid unsupported claims of seeing private provider internal state.
- AI provider adapters: discover compatible installed CLI tools, let user select; multiple independent CLI accounts/profiles and API providers. Credentials stay on respective hosts and are not synchronized. Provider-independent AION conversation/project storage. Per-message smart routing across permitted accounts/models with budget/usage constraints and manual override. Respect provider-specific supported reasoning/control features.

## 6. AI execution, tasks, parallel agents

- Modes: **Ask**, **Plan (read-only)**, **Execute**. Backend-enforced permissions. Default requires approval for modifications; extra approvals for sensitive/out-of-scope; optional explicitly granted Full Access does not permit crossing assigned capabilities or trust boundaries.
- Unified task model: manual tasks, proposed AI plans, AI-executed tasks, statuses, assignees, links to files/chat, audit history, checkpoints. Approve **a bounded task batch**; an agent may continue autonomously within that approved scope/budget but must ask for new batch/unrelated/out-of-scope or sensitive work. Per-project preferred host/model/failure policy/budget can be remembered, but prior preferences are **not execution authorization**.
- User **manually chooses execution host for each approved batch**. No automatic failover/migration across independent hosts. Tasks may continue on selected host if phone/UI disconnects.
- Durable execution records with base revision, allowed folders/tools, intended changes, process lifecycle, checkpoints, idempotency/reconciliation, timeout, cancellation and output limits. After restart distinguish verified completion from unknown side effects; never automatically repeat uncertain destructive actions.
- Parallel agents within one project communicate through bounded structured coordination/events (not endless model calls). Reserve/coordinate file ownership, isolate workspaces where feasible, validate base revisions before integration, block conflicting modifications. Approved validated compatible changes can auto-integrate and publish promptly to online hosts, with concise summary, evidence, diffs and recoverable versions. Failed verification: bounded in-scope repair when approved or stop for review.

## 7. Sync and file safety

- All eligible projects and ordinary standalone Synced Folders **two-way synchronize across all trusted AION hosts**, each with its host-specific folder map. Sync is *not* the same as backup. No per-project host selection for sync membership.
- Normal working-folder sync every **5 minutes**, incremental event/manifests, adjust on battery/metered conditions; catch up promptly upon reconnection; manual Sync Now. **Active approved AI changes publish event-triggered promptly after validated safe write**; never guarantee instant transfer when offline.
- Version/revision ancestry, content hashes, transfer acknowledgments, dedupe/replay safety, tombstones, resumable transfers. Do not synchronize open SQLite DB files.
- Conflicts: **preserve both variants** and pause only affected file integration; present Keep A / Keep B / Both / Merge where supported. Concurrent offline edits cannot be resolved by newest timestamp. Significant mass deletion/modification: pause affected batch and ask simple **yes/no to synchronize**; other sync continues.
- Deleted files and prior sync revisions recoverable **7 days**, subject to retention/storage policy and host availability. Track deletion/restore safely.
- Folder exclusion rules must not accidentally transmit hidden secrets. Full content indexing opt-in independently of sync.

## 8. Automations

- Users describe automation in natural language; AI proposes a **structured declarative workflow** with triggers, conditions, actions, authorized host/resources, budget, policies. User inspects, validates, dry-runs or controlled live-tests, then **explicitly activates**.
- Supported scheduled and event triggers (file/sync/task and supported app events). Durable event processing, audit history, errors and notifications inside Tasks > Automations.
- Only scoped unattended actions allowed; out-of-scope/high-risk/new actions require fresh approval; no arbitrary generated scripts as an implicit blanket exemption.
- **Per-automation missed schedule policy:** Catch Up or Skip. Assigned host only, **no automatic failover**.
- **Per-automation failure policy:** bounded safe retries/backoff with idempotency and result reconciliation OR stop and notify. Unknown external side effects are not blindly retried.
- If automation retriggers during an active run, **queue one consolidated pending run** retaining all meaningful source event references; don't run parallel copies of same automation.
- AI can diagnose failures/propose fixes; material definition changes require re-review/approval.

## 9. Backups, updates, onboarding

- Automatic **weekly workspace backups** (chats, project memory, settings, task metadata etc.) with **30-day retention**, verified integrity and guided restore. Project working files and standalone synced folder data are **opt-in for backup**. Destinations: same disk (warn), external disk, network share. Incremental where supported, avoid growing unbounded. Old backup restore must not silently replace newer multi-host data.
- Check GitHub Releases **every 24 hours** and manually; notify first and install only with explicit approval. Require verified signed/hashed release artifacts, staged update, data preservation, rollback compatible with schema migrations. Don't run `git pull` on user's installed code as update mechanism.
- First-run: create/join host, initial Owner/recovery key, discover AI tools, optional Tailscale, pair PWA, progressive contextual help. All in-window; optional tasks can be skipped/deferred.

## 10. My Devices and OS controls

- Device detail shows capabilities, status, safe system info, file access, task execution, remote screen/control only when authorized and supported. Host is explicit for each operation.
- Screen sharing/control requires explicit **session-scoped consent**, a visible local indicator, time limit, capability checks and audit; never just a generic bearer token. Remote OS actions require authorization and sensitive-action confirmation as appropriate.
- Wake on LAN only where helper/router hardware/network setup supports it. Do not promise wake from internet via arbitrary home routers or unsupported iPhone shortcuts. No Find My Phone in Beta 1.

## 11. Runtime and architecture boundaries

- Modular monolith boundaries: `desktop-shell`, `host-supervisor`, `local-api`, `identity`, `authorization`, `approval`, `project-state`, `chat-memory`, `ai-providers`, `task-orchestrator`, `worker-isolation`, `sync-engine`, `automation-engine`, `search-index`, `device-adapters`, `update-client`, `backups`, `observability`, `pwa-client`, `ui-design-system`. They are conceptual boundaries, not mandatory independent services.
- Local SQLite schema-versioned transactional storage; replication exchanges authorized structured records/events, not DB files. Per-device identity, revocation, immutable audit trails, host/local path separation.
- Safe logging: redact secrets/private data, retention/rotation bounds. Use event-driven scheduling and state, not numerous idle polling loops. Bounded work queues, memory and I/O resource budgets. Where OS/native testing is unavailable, clearly label unverified and continue independent work.

## 12. Current verified/claimed implementation baseline (must recheck)

As reported 2026-11-15, active repo `C:\aion-public-source`, fresh GitHub `main` root `5cb7060`; development branch `feature/identity-security-completion`, draft PR #1. Phase 1 containment: loopback bind, disabled unsafe runner/CLI/screen/update, no loopback Owner bypass, same-origin controls. Phase 2A: SQLite identity, Ed25519 keys/challenges, Owner/Trusted/Limited capability checks, recovery key and DPAPI vault with synthetic migration tests, in-window security UI. Reported 43 focused tests passed and isolated native build succeeded; isolated Node host idle 600s median ~66.7MB and P95 ~66.9MB. **Not verified:** real native WebView2 interaction/lifecycle, full process-tree footprint, Arabic RTL/German UI, real-installed DPAPI migration, profile recovery. Eco/Balanced/Performance initially only adjusted hardware probe cadence, NOT a full Resource Governor. Status may have evolved since this snapshot: **inspect actual source, tests, reports and remote refs; never assume these results still hold**.

## 13. Engineering process, documentation and release

- Codex is implementation partner. Develop efficiently via continuous **complete, secure vertical slices**, progressing to next unblocked task without unnecessary per-phase pauses. Do not fabricate progress, claim implementation of vision-only capabilities, or promise indefinite asynchronous work beyond execution session.
- Tests first/alongside code: route/auth threat tests, serialization/DB crash tests, concurrency, offline sync/partition tests, approval and restart recovery, automation side-effect dedupe, installer rollback, localization/RTL, native window UX, measurable weak/strong hardware benchmarks.
- Every coherent tested milestone → Conventional Commit under legitimate configured `aawal-code` identity → privacy/history scan → authorized normal push to feature branch → maintain PR. No fake commits, AI tool promotional branding, unauthorized history rewrite, release or deployment. `main` stays stable; merge after acceptance gates. User wants genuine regular GitHub visible contributions.
- README should be premium **product-first**: AION tagline “Your AI. Your devices. Your workspace.”, authentic hero image, six pillars (AI Workspace; Devices; Files; AI Tasks; Automations; Customization), real screenshots/GIFs when verified, download/install, security/how it works, languages/themes, docs/contributing/license. **Never substitute fake images or mark planned features as shipping**. Maintain asset manifest, accurate status table, docs, and changelog. Deliberately choose a real OSI license before claiming open-source distribution rights.
- Public release only after verified clean Windows packaging, secure default config, signed/update path, E2E scenarios, backups/restore, performance, localization, privacy scans, documentation and an authorized release gate.

## 14. Source-of-truth policy for Codex

1. Treat this document as **intended behavior**. Treat code/test/runtime evidence as **implementation status**.
2. A decision here overrides incidental earlier prototypes or marketing descriptions, **but never overrides security/OS constraints**.
3. Do not reinterpret a feature broadly when precise behavior is documented (manual execution-host choice, all-host sync, conflict preservation, approvals, opt-in content indexing etc.).
4. When implementing, add acceptance tests mapping back to applicable section IDs and update implementation status honestly.
5. If a fundamental conflict or true ambiguity arises, record design options and ask only about the unresolved decision. Do not silently invent behavior.

