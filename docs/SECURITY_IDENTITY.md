# Identity and authorization boundary (Phase 2A)

## Trust model

Network location is not an identity. Loopback, a private address, Tailscale membership, and a device name never grant a role. The listener remains loopback-only under Phase 1.

The native desktop shell holds a per-start secret only in its child-process environment. It exchanges that secret once for an HttpOnly, `SameSite=Strict` browser session. This is a compatibility bridge for the trusted desktop host—not a general local-process bypass. Browser-only source launches are intentionally unsupported until local IPC is designed.

Other devices use Ed25519 public keys. A device signs a one-time server challenge; a successful signature creates an opaque, hashed, 20-minute session. Challenges are single-use and stored consumed transactionally. Browser sessions are delivered only in HttpOnly, `SameSite=Strict` cookies and tokens are never accepted in URLs. State-changing browser requests require an exact same-origin check and synchronizer CSRF token.

## Roles and capabilities

| Role | Capabilities |
|---|---|
| Owner | All capabilities; can enroll/revoke devices and recover ownership. |
| Trusted | Explicitly granted device/system read and conversation capabilities within the Trusted ceiling. It cannot manage identity, secrets, OS control, screen control, updates, or execute CLI work. |
| Limited | Explicitly granted device-read capability only. |

The router assigns a required capability before dispatching protected APIs. Each non-Owner device persists its allowed capabilities transactionally; an empty grant set has no authority, and a requested grant outside the device role's ceiling is rejected. Phase 1-disabled APIs remain disabled regardless of role.

## Enrollment and recovery

Initial Owner enrollment requires a five-minute bootstrap session minted after the native host proves its startup secret, and may occur only when no active Owner exists. That bootstrap session cannot authorize normal API calls. The server returns a 256-bit recovery key exactly once and persists only a salted SHA-256 verifier. Recovery requires that key plus a new verified native-local bootstrap, revokes active owners/sessions, creates a replacement Owner, and rotates the recovery key. Recovery restores authority only; it does not recreate project data.

An Owner can create a five-minute pairing invitation inside AION. The locally generated QR payload contains only `AION-PAIR:<invitation-id>`; it carries neither a session credential nor authority. A joining device submits an Ed25519 public key exactly once and receives the same short-lived comparison code shown to the Owner. The code is not an authorization credential: the Owner must explicitly approve the claimed public key with a permitted role/grant set. Claim and approval transitions are transactional and auditable. This is an enrollment foundation only: it does not yet provide a reachable encrypted multi-host transport.

## Persistence and operations

`data/security.sqlite` is a schema-versioned SQLite store with WAL, foreign keys, transactional owner/revocation/recovery changes, scoped desktop-bootstrap hashes, and append-only audit events. It stores public keys, role grants, hashes of opaque sessions/challenges, recovery-key verification material, and audit metadata—never raw device private keys, raw sessions, or recovery keys. On Windows, API credentials are DPAPI CurrentUser protected; legacy deterministic vault bytes are copied to `vault.legacy.enc` before a successful atomic migration.

The transport identity is a separate ECDSA P-256 TLS certificate generated with `@peculiar/x509` and stored as a DPAPI-protected PKCS#8 bundle. Node's TLS implementation requires TLS 1.3 and mutual certificate verification. Certificates renew when fewer than 14 days remain. This certificate proves only possession of a transport key; it does not by itself authorize a host. A subsequent transport-binding protocol must verify its pinned fingerprint and a channel-bound Ed25519 proof against an Owner-approved AION device.

Before an installed-data migration, copy `security.sqlite` and legacy `trusted-devices.json` to a user-controlled backup location and verify restoration in an isolated profile. Phase 2A deliberately does not delete or silently convert legacy device credentials; legacy PIN pairing is disabled.

## Current limits

Windows API credentials are protected with DPAPI CurrentUser in `src/services/vault.js`. Synthetic tests cover legacy-vault backup, migration, restart readback, and corrupted legacy data failing closed; they do not validate an installed-data migration, a different Windows-user context, interrupted migration, or WebView2-profile loss. Session renewal, Owner-approved QR/matching-code pairing, encrypted remote transport, and high-impact approval workflows remain future work. A local user who can extract another user's browser cookie remains outside the protections of this prototype and requires OS-account/IPC hardening.
