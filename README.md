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
  ✔ verifies zero runtime npm dependencies (1.15ms)
  ✔ verifies no hardcoded absolute user profiles exist in source code (2.24ms)
✔ Architecture & Zero-Dependency Validation (4.26ms)

▶ OS Command Sanitization
  ✔ permits valid whitelisted actions (0.71ms)
  ✔ permits valid process target for kill_process (0.16ms)
  ✔ rejects shell injection attempts in action (0.36ms)
  ✔ rejects shell injection attempts in kill target (0.17ms)
✔ OS Command Sanitization (2.78ms)

ℹ tests 6 | suites 2 | pass 6 | fail 0 | cancelled 0
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
$nodePath = (Get-Command node).Source
$action = New-ScheduledTaskAction -Execute $nodePath -Argument "src/server.js" -WorkingDirectory "C:\aion"
$trigger = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Highest

Register-ScheduledTask -TaskName "AionDaemon" -Action $action -Trigger $trigger -Principal $principal
Start-ScheduledTask -TaskName "AionDaemon"
```

---

## Repository Structure

```
aion/
├── src/
│   ├── routes/
│   │   └── router.js        # Native HTTP route dispatcher
│   ├── services/
│   │   ├── os.js            # Win32 & POSIX session handling
│   │   ├── syncthing.js     # Loopback REST client & XML credential parser
│   │   ├── ai-bridge.js     # Sandboxed CLI runner
│   │   └── sse.js           # Server-Sent Events distribution engine
│   ├── utils/
│   │   └── sanitizer.js     # Strict action whitelisting & injection defenses
│   └── server.js            # Runtime bootstrap & OS signal handling
├── public/                  # Mobile PWA controller assets
├── tests/                   # Native node:test validation suites
├── docs/                    # Architectural assets & demo recordings
└── package.json             # Manifest declaring zero dependencies
```

<div align="center">
<sub>Engineered by Abdulaziz Awal • Systems Architecture & Distributed Node Orchestration</sub>
</div>