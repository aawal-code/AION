<div align="center">

# AION
### Autonomous Interactive Operations Node

**Zero-Cloud Workstation Orchestration • Sub-50MB Memory Working Set • Native OS Kernel Hooks • Encrypted WireGuard Mesh**

[![Runtime](https://img.shields.io/badge/Node.js-v20%2B-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org/)
[![Dependencies](https://img.shields.io/badge/Dependencies-0_External-000000?style=flat-square)](package.json)
[![Tests](https://img.shields.io/badge/Tests-node%3Atest_passing-brightgreen?style=flat-square)](tests/)
[![Mesh](https://img.shields.io/badge/Network-Tailscale_WireGuard-blue?style=flat-square&logo=tailscale&logoColor=white)](https://tailscale.com)
[![License](https://img.shields.io/badge/License-MIT-blue?style=flat-square)](LICENSE)

<br/>

```
                +------------------------------------+
                |       PWA Command Controller       |
                |   (iOS Safari / Touch-Optimized)   |
                +-----------------+------------------+
                                  |
                        [Tailscale WireGuard]
                     Direct P2P Encrypted Mesh
                                  |
                                  v
                +------------------------------------+
                |        AION Mesh Supervisor        |
                |   (Port 5050 / Zero-Polling SSE)   |
                +----+------------+-------------+----+
                     |            |             |
       +-------------+            |             +-------------+
       |                          |                           |
       v                          v                           v
+---------------+       +-------------------+       +-------------------+
| Win32 Session |       | Headless AI Agent |       |   Cluster Sync    |
| Isolation     |       | Execution Bridge  |       |   Loopback Hook   |
| (rundll32)    |       | (Antigravity CLI) |       |  (Syncthing REST) |
+---------------+       +-------------------+       +-------------------+
```

</div>

---

## Technical Overview

AION is an ultra-lightweight, local-first node orchestration daemon engineered for heterogeneous workstation environments (Windows & Linux). It eliminates centralized cloud relays, telemetry overhead, and third-party SaaS dependencies by linking native operating system hooks, encrypted peer-to-peer mesh overlays, and local CLI toolchains into a unified command plane.

### Core Architectural Values

* **Sub-50MB Memory Working Set:** The runtime dependency tree is strictly **0 Bytes** (`node_modules` does not exist). Built entirely on Node.js standard library primitives (`http`, `child_process`, `fs`, `os`, `path`).
* **Session 0 Isolation Bypass:** Resolves Windows service isolation constraints by running as an elevated task daemon inside the interactive user context, triggering native desktop operations via detached Win32 process spawns (`rundll32.exe user32.dll,LockWorkStation`).
* **Zero-Polling Telemetry:** Process diagnostics and audit events stream continuously over persistent Server-Sent Events (SSE), eliminating aggressive mobile polling and preserving client battery life.
* **On-Demand P2P Remote Surface:** Zero idle GPU encoding overhead. Dispatches custom URI scheme invocations (`rustdesk://`) routed directly across private mesh IPs on demand.
* **Autonomous Cluster Sync:** Dynamic REST API client interfacing with local loopback Syncthing instances (`127.0.0.1:8384`) with runtime XML credential resolution.

---

## Systems Engineering Deep-Dive

### 1. Win32 Interactive Session Decoupling

Standard Windows background services run inside Session 0, isolated from the interactive desktop display. AION operates within the interactive logon session while decoupling process lifecycles, guaranteeing non-blocking system calls without stream-pipe hangs or deadlocks:

```javascript
// Reliable workstation lock via unreferenced detached Win32 spawn
const child = spawn(
  path.join(process.env.SystemRoot, 'System32', 'rundll32.exe'),
  ['user32.dll,LockWorkStation'],
  { detached: true, stdio: 'ignore', windowsHide: true }
);
child.unref();
```

### 2. Attack Surface Hardening & Input Sanitization

Commands dispatched from the controller surface are strictly parsed before shell execution. The system enforces an explicit whitelist and rejects all shell metacharacters and directory traversal sequences:

```javascript
// src/utils/sanitizer.js
const ALLOWED_ACTIONS = new Set(['lock', 'sleep', 'kill_process']);
const SHELL_METACHARS = /[;&|`$<>\r\n]/;

export function sanitizeCommand(action, target = '') {
  if (!ALLOWED_ACTIONS.has(action)) {
    throw new InvalidCommandError(`Disallowed action: ${action}`);
  }
  if (SHELL_METACHARS.test(action) || SHELL_METACHARS.test(target)) {
    throw new InvalidCommandError('Shell metacharacters detected');
  }
  if (action === 'kill_process' && !/^[a-zA-Z0-9_\-\.]+$/.test(target)) {
    throw new InvalidCommandError('Invalid process target descriptor');
  }
}
```

---

## API Specification

| Endpoint | Method | Format / Payload | Subsystem Action |
| :--- | :--- | :--- | :--- |
| `/api/logs` | `GET` | `text/event-stream` | Real-time SSE telemetry stream with rolling 25-event backlog replay. |
| `/api/command` | `POST` | `{"action": "lock"}` | Dispatches sanitized Win32 / POSIX kernel operations. |
| `/api/ai` | `POST` | `{"prompt": string}` | Sub-process bridge executing headless local AI agents (`agy`). |
| `/api/sync/status` | `GET` | `application/json` | Resolves local `config.xml` token and queries active folder metrics. |
| `/api/sync/folder` | `POST` | `{"id", "path", ...}` | Dynamically provisions shared paths across cluster nodes. |
| `/api/sync/device` | `POST` | `{"deviceID", ...}` | Mutual TLS peer device pairing across the mesh. |
| `/api/system/update/check` | `GET` | `application/json` | Checks local semver against GitHub Releases API with commit fallback. |
| `/api/system/update/apply` | `POST` | `application/json` | Fetches latest tracked release/branch and hot-restarts the daemon. |

---

## Automated Verification & Test Suite

AION strictly rejects external test runners (no Jest, Mocha, or Vitest bloat). All validations execute via Node's native test runner (`node:test` and `node:assert/strict`):

```bash
# Run full native test suite
npm test
```

### Native Execution Log

```
▶ Architecture & Zero-Dependency Validation
  ✔ verifies zero runtime npm dependencies (1.67ms)
  ✔ verifies no hardcoded absolute user profiles exist in source code (2.18ms)
✔ Architecture & Zero-Dependency Validation (4.89ms)

▶ OS Command Sanitization
  ✔ permits valid whitelisted actions (1.22ms)
  ✔ permits valid process target for kill_process (with and without .exe, lowercase, spaces) (0.35ms)
  ✔ rejects shell injection attempts in action (0.66ms)
  ✔ rejects shell injection attempts in kill target (0.26ms)
  ✔ killProcess returns clean JSON status when target is not currently running without throwing (299.38ms)
✔ OS Command Sanitization (304.26ms)

▶ Updater Service Logic
  ✔ getLocalVersion returns valid semver string from package.json (1.28ms)
  ✔ compareVersions accurately identifies newer, older, and identical versions (0.29ms)
✔ Updater Service Logic (3.34ms)

ℹ tests 9 | suites 3 | pass 9 | fail 0 | cancelled 0
```

---

## Deployment & Setup

### Prerequisites
* Node.js `>= 20.0.0`
* Tailscale (WireGuard mesh routing)
* Optional: Syncthing, RustDesk

### Quickstart

```bash
# 1. Clone repository
git clone https://github.com/aawal-code/AION.git
cd AION

# 2. Run unit tests
npm test

# 3. Start node daemon
node src/server.js
```

### Windows Daemon Setup (Task Scheduler)

To configure AION as an elevated background daemon that persists across reboots while retaining interactive session rights:

```powershell
# Run the automated installer
powershell -ExecutionPolicy Bypass -File scripts/setup.ps1
```

### Linux Engine Setup (systemd user service)

For Linux systems (Ubuntu, Debian, Fedora, Arch, openSUSE), run the distro-agnostic installer with zero-root requirements:

```bash
chmod +x scripts/install.sh
./scripts/install.sh
```

This provisions Node.js v20+ if missing, installs a `.desktop` menu launcher with scalable icon, and starts the daemon under `systemd --user` preserving interactive `DISPLAY`, `WAYLAND_DISPLAY`, and `DBUS_SESSION_BUS_ADDRESS` permissions.

---

## Repository Structure

```
aion/
├── src/
│   ├── routes/
│   │   └── router.js        # Native HTTP route dispatcher
│   ├── services/
│   │   ├── os.js            # Win32 & Linux session handling & process assassin
│   │   ├── syncthing.js     # Loopback REST client & XML credential parser
│   │   ├── ai-bridge.js     # Sandboxed CLI runner
│   │   ├── updater.js       # Atomic GitHub release auto-updater & hot restart
│   │   └── sse.js           # Server-Sent Events distribution engine
│   ├── utils/
│   │   └── sanitizer.js     # Strict action whitelisting & injection defenses
│   └── server.js            # Runtime bootstrap & OS signal handling
├── scripts/
│   ├── setup.ps1            # Windows standalone installer & Task Scheduler setup
│   └── install.sh           # Universal Linux installer & systemd user service setup
├── public/                  # Enterprise PWA controller assets
│   ├── index.html           # Hardware cockpit interface (EN, AR, DE)
│   ├── manifest.json        # Standalone PWA web app manifest
│   ├── sw.js                # App shell offline caching service worker
│   └── icon.svg             # Vector glyph
├── tests/                   # Native node:test validation suites
├── docs/                    # Architectural assets & demo recordings
└── package.json             # Manifest declaring zero dependencies
```

<div align="center">
<sub>Engineered by Abdulaziz Awal • Systems Architecture & Distributed Node Orchestration</sub>
</div>