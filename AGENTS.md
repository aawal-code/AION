# AION repository guidance

Before changing AION, read `docs/AION_MASTER_SPEC.md`, `docs/SECURITY_IDENTITY.md`,
`docs/DEVELOPMENT_STATUS.md`, and `AION_PHASE_2A_REPORT.md`. The master specification
defines intended behavior; code, tests, and current reports define verified status.

Work only in this public-source repository. Do not modify `C:\aion`, which is an archived
original repository. Preserve unrelated working-tree changes and runtime data. Keep security
host-enforced, fail closed, and do not restore disabled remote execution, screen control,
plaintext access, or unsafe updates without an approved, tested design.

For each coherent change, add or update acceptance tests that reference the relevant master
specification section, run relevant checks, scan for sensitive data, and report status honestly.
Commit focused Conventional Commits using the configured identity; push only authorized tested
work to the development branch and never merge, release, or deploy without explicit approval.
