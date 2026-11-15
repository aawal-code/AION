# Identity and authorization boundary (Phase 2A)

## Trust model

Network location is not an identity. Loopback, a private address, Tailscale membership, and a device name never grant a role. The listener remains loopback-only under Phase 1.

The native desktop shell holds a per-start secret only in its child-process environment. It exchanges that secret once for an HttpOnly, `SameSite=Strict` browser session. This is a compatibility bridge for the trusted desktop host—not a general local-process bypass. Browser-only source launches are intentionally unsupported until local IPC is designed.

Other devices use Ed25519 public keys. A device signs a one-time server challenge; a successful signature creates an opaque, hashed, 20-minute session. Challenges are single-use and stored consumed transactionally. Tokens are never accepted in URLs.

## Roles and capabilities

| Role | Capabilities |
|---|---|
| Owner | All capabilities; can enroll/revoke devices and recover ownership. |
| Trusted | Read device/system state and use conversation data. It cannot manage identity, secrets, OS control, screen control, updates, or execute CLI work. |
| Limited | Read device state only. |

The router assigns a required capability before dispatching protected APIs. Phase 1-disabled APIs remain disabled regardless of role.

## Enrollment and recovery

Initial Owner enrollment requires the native bootstrap secret and may occur only when no active Owner exists. The server returns a 256-bit recovery key exactly once and persists only a salted SHA-256 verifier. Recovery requires that key plus the same verified native-local bootstrap, revokes active owners/sessions, creates a replacement Owner, and rotates the recovery key. Recovery restores authority only; it does not recreate project data.

## Persistence and operations

`data/security.sqlite` is a schema-versioned SQLite store with WAL, foreign keys, transactional owner/revocation/recovery changes, and append-only audit events. It stores public keys, role grants, hashes of opaque sessions/challenges, recovery-key verification material, and audit metadata—never raw device private keys, raw sessions, or recovery keys.

Before an installed-data migration, copy `security.sqlite` and legacy `trusted-devices.json` to a user-controlled backup location and verify restoration in an isolated profile. Phase 2A deliberately does not delete or silently convert legacy device credentials; legacy PIN pairing is disabled.

## Current limits

Windows DPAPI-backed storage is not yet used because this phase persists no recoverable secret material; API-vault migration remains separate work. Session renewal, device UI, owner approval screens, and encrypted remote transport are also future work. A local user who can extract another user's browser cookie remains outside the protections of this prototype and requires OS-account/IPC hardening.
