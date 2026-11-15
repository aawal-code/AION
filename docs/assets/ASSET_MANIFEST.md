# AION documentation asset manifest

This directory reserves release-ready GitHub assets. It contains no generated or synthetic product imagery.

## Paths and names

* Screenshots: `docs/assets/screenshots/<area>-<state>-<theme>-<locale>-<YYYYMMDD>.png`
* Demos: `docs/assets/demos/<area>-<workflow>-<theme>-<locale>-<YYYYMMDD>.webm`
* Use lowercase kebab case. Areas: `chat`, `projects`, `tasks`, `automations`, `devices`, `sync`, `settings`, `onboarding`.

## Required release asset set

| Asset | Required real state | Status |
|---|---|---|
| Hero | Running AION desktop application | Not captured |
| Chat | Functioning provider-neutral conversation | Not captured |
| Projects | Real project/session organization | Not captured |
| Tasks | Approved task execution state | Blocked: executor disabled in Phase 1 |
| Automations | Durable automation history | Blocked: not implemented |
| Devices | Local status and explicitly labelled remote state | Not captured |
| Sync | Verified encrypted multi-host synchronization | Blocked: not implemented |
| Themes/RTL | Verified dark/light and Arabic RTL view | Not captured |

## Capture requirements

1. Capture only manually verified release-candidate flows, at 1600x1000 or 1920x1200, with a lossless original PNG.
2. Capture meaningful theme changes and Arabic RTL after visual QA; redact names, hostnames, IDs, IPs, secrets, paths, notification content, and third-party data.
3. Never composite states, fabricate badges, or use screenshots of unavailable features. Optimize approved PNGs losslessly; use muted WebM/VP9 or AV1 demos where useful, preferably under 8 MB.
4. Review at 100%, mobile width, light/dark contrast, and RTL before adding an asset to README.

## README publication gate

Do not assemble the final product README until every referenced capability has a verified asset or is accurately marked unavailable. Preserve the existing README as the development overview; release badges must come from real release metadata.
