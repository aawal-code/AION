# AION

Autonomous Interactive Operations Node is an in-development, local-first Windows desktop host with a browser-based companion UI.

## Development status

This source repository is a security-focused development snapshot. It is not a production release.

| Area | Status |
|---|---|
| Desktop host and local PWA shell | Development / local-only |
| Local device telemetry and media controls | Development |
| Phase 1 containment | Implemented: loopback-only binding; remote screen control, arbitrary CLI execution, remote plaintext access, and update apply are disabled |
| Phase 2A identity foundation | In progress: signed device sessions, scoped desktop bootstrap, in-window enrollment/recovery/device management, and Windows-protected vault code are implemented; native build, localization, and sustained performance validation remain incomplete |
| Multi-host synchronization | Not implemented as a secure AION protocol |
| Automations and durable task execution | Not implemented |
| Public installer or release | Not available |

Do not expose this host to a LAN or the internet. Remote capabilities remain intentionally unavailable until encrypted transport, device enrollment UX, explicit approvals, and independent security testing are complete.

## Running from source

Requires a supported Node.js runtime. This source tree initializes runtime state under `data/` automatically; do not commit that state.

```powershell
npm test
npm start
```

For normal local desktop use, use the native shell after a clean Windows build. Browser-only source launch is a development workflow and does not replace the native desktop authentication bootstrap.

## Documentation

- [Phase 1 report](AION_PHASE_1_REPORT.md)
- [Phase 2A report](AION_PHASE_2A_REPORT.md)
- [Product and engineering master specification](docs/AION_MASTER_SPEC.md)
- [Requirements traceability matrix](docs/REQUIREMENTS_TRACEABILITY.md)
- [Identity and authorization boundary](docs/SECURITY_IDENTITY.md)
- [Documentation asset manifest](docs/assets/ASSET_MANIFEST.md)

The asset manifest reserves future screenshot and demo paths. Only genuine, verified captures may be added; no synthetic product screenshots or misleading release claims belong in this repository.

## Contributing

Use focused Conventional Commits, keep runtime state and credentials out of Git, run relevant tests, and open reviewed pull requests into `main`. Do not re-enable disabled remote or execution features without their documented security gates.
