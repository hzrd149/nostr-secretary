---
phase: 02-save-notification-preferences-as-encrypted-1xxxx-nostr-event
plan: 02
subsystem: auth
tags: [nip-46, nostr-connect, applesauce-signers, nip-44, permissions]

# Dependency graph
requires:
  - phase: 02-01
    provides: phase symbol map / shared context for the 30078 preferences-sync feature
provides:
  - "Expanded SIGNER_PERMISSIONS constant requesting get_public_key, sign_event:22242, sign_event:30078, nip44_encrypt, nip44_decrypt"
  - "All three NIP-46 signer-connect call sites (pages/signer.tsx x2, pages/home.tsx x1) wired to actually request SIGNER_PERMISSIONS"
  - "QR-encoded nostr-connect URIs now carry the requested permissions (previously a second bare getNostrConnectURI() call leaked no-permission URIs into the QR image)"
affects: [02-03, 02-04]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "NIP-46 permission strings built via NostrConnectSigner.buildSigningPermissions([...kinds]) plus manually appended nip44_encrypt/nip44_decrypt literals (not produced by buildSigningPermissions)"
    - "QR-encoded connect URI reuses the already-computed, permissions-bearing connectUrl variable instead of re-calling getNostrConnectURI() a second time"

key-files:
  created: [tests/const.test.ts]
  modified: [const.ts, pages/signer.tsx, pages/home.tsx]

key-decisions:
  - "Used the literal kind 30078 in the buildSigningPermissions() call (not an import of PREFS_KIND from helpers/preferences) to avoid adding a new import to const.ts, per the plan's explicit discretion note"
  - "Fixed the QR code to reuse connectUrl instead of a second bare getNostrConnectURI() call in both signer.tsx and home.tsx — required for the permissions to actually reach the scanned QR image, and incidentally removes a pre-existing duplicate-call dead-code path noted in CONCERNS.md"

patterns-established:
  - "SIGNER_PERMISSIONS is the single source of truth for NIP-46 permission scope; any new signer-connect call site must import and pass it"

requirements-completed: [D2-13]

coverage:
  - id: D1
    description: "SIGNER_PERMISSIONS expanded to request get_public_key, sign_event:22242, sign_event:30078, nip44_encrypt, nip44_decrypt"
    requirement: "D2-13"
    verification:
      - kind: unit
        ref: "tests/const.test.ts#SIGNER_PERMISSIONS"
        status: pass
    human_judgment: false
  - id: D2
    description: "All three NIP-46 signer-connect call sites (pages/signer.tsx getNostrConnectURI + fromBunkerURI, pages/home.tsx getNostrConnectURI) pass permissions: SIGNER_PERMISSIONS, and the QR-encoded URI carries them"
    requirement: "D2-13"
    verification:
      - kind: unit
        ref: "bun run lint (tsc --noEmit) — typechecks the new options objects"
        status: pass
    human_judgment: true
    rationale: "Wiring is statically verified (typecheck + grep-confirmed call sites), but confirming a live bunker actually prompts for kind-30078 signing + NIP-44 permissions requires a real NIP-46 signer session, per the plan's Manual verification note — carried to /gsd-verify-work"

# Metrics
duration: 5min
completed: 2026-07-09
status: complete
---

# Phase 02 Plan 02: Wire NIP-46 SIGNER_PERMISSIONS Into All Connect Call Sites Summary

**Expanded `SIGNER_PERMISSIONS` to request kind-30078 signing plus NIP-44 encrypt/decrypt, and — critically — wired the constant into all three NIP-46 signer-connect call sites (previously dead code), including fixing the QR-encoded URI to actually carry the requested permissions.**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-07-09T18:22:00-05:00 (approx, first commit 18:22:45)
- **Completed:** 2026-07-09T18:25:40-05:00
- **Tasks:** 2
- **Files modified:** 4 (const.ts, tests/const.test.ts, pages/signer.tsx, pages/home.tsx)

## Accomplishments
- `SIGNER_PERMISSIONS` now requests `get_public_key`, `sign_event:22242`, `sign_event:30078`, `nip44_encrypt`, `nip44_decrypt` — locked in by a 5-assertion test (`tests/const.test.ts`)
- Fixed Pitfall 4 (research finding): `SIGNER_PERMISSIONS` was previously dead code — no call site referenced it. Now wired into `pages/signer.tsx`'s `getNostrConnectURI` (connectUrl) call, its `NostrConnectSigner.fromBunkerURI` manual-bunker path, and `pages/home.tsx`'s `getNostrConnectURI` call.
- Fixed the QR code generation in both pages to reuse the permissions-bearing `connectUrl` instead of making a second, bare `getNostrConnectURI()` call — the scanned QR image now actually carries the requested permission scope, not just the on-screen text.

## Task Commits

Each task was committed atomically:

1. **Task 1: Expand SIGNER_PERMISSIONS and add a guard test** — `c17327c` (test, RED), `6f3fea0` (feat, GREEN)
2. **Task 2: Wire SIGNER_PERMISSIONS into all three signer-connect call sites** — `955f985` (feat)

_TDD Task 1 followed RED → GREEN: `tests/const.test.ts` was written and confirmed failing (3/5 assertions red against the un-expanded constant) before `const.ts` was expanded._

## Files Created/Modified
- `const.ts` - `SIGNER_PERMISSIONS` expanded via `NostrConnectSigner.buildSigningPermissions([kinds.ClientAuth, 30078])` + appended `"nip44_encrypt"`, `"nip44_decrypt"` literals
- `tests/const.test.ts` - New: 5 membership assertions guarding the exact permission set (get_public_key, sign_event:22242, sign_event:30078, nip44_encrypt, nip44_decrypt)
- `pages/signer.tsx` - Import merged (`DEFAULT_SIGNER_RELAY, SIGNER_PERMISSIONS`); `connectUrl`'s `getNostrConnectURI` options now include `permissions: SIGNER_PERMISSIONS`; `qrCodeUrl` now derives from `connectUrl` instead of a second bare call; `NostrConnectSigner.fromBunkerURI(bunkerUri.trim(), { permissions: SIGNER_PERMISSIONS })` in the PATCH handler
- `pages/home.tsx` - Same import merge and `connectUrl`/`qrCodeUrl` fix as signer.tsx

## Decisions Made
- Used the literal `30078` (not `PREFS_KIND` from `helpers/preferences`) in `const.ts` to avoid introducing a new import into a plain constants file — the plan explicitly allowed either.
- Confirmed via `.d.ts` inspection of the installed `applesauce-signers@6.0.1` that `getNostrConnectURI(metadata?: NostrConnectAppMetadata)` and `fromBunkerURI(uri, options?: { permissions?: string[] })` both accept a `permissions: string[]` field, matching the plan's assumed API shape exactly.

## Deviations from Plan

None - plan executed exactly as written. The QR-code-reuse fix was explicitly called for in the plan's Task 2 action text ("Prefer reusing the already-computed connectUrl variable in the qrCodeUrl template"), not an unplanned deviation.

## Issues Encountered

The plan's Task 2 acceptance criterion `grep -q "fromBunkerURI(bunkerUri.trim(), { permissions: SIGNER_PERMISSIONS })" pages/signer.tsx` (a single-line match) does not literally match the file on disk: `prettier` (already configured, `bun run lint`-clean) wraps this call across three lines because the single-line form exceeds the project's line-length formatting. The equivalent multi-line grep (`grep -c "permissions: SIGNER_PERMISSIONS" pages/signer.tsx` → 2) confirms the same functional wiring. No code change was made to force a single line, since that would fight the project's existing Prettier formatting.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- `SIGNER_PERMISSIONS` is no longer dead code; any future NIP-46 signer connection (fresh QR scan or manual bunker URI entry) requests the full permission set needed for kind-30078 signing and NIP-44 encrypt/decrypt.
- Plan 03 (publish/subscribe pipelines) can now rely on newly-connected signers having been asked for these permissions at connect time. Per the plan's explicit note, already-connected signers from before this change were not re-prompted (no SDK API exists for that) — Plan 03 must still handle an under-permissioned existing session gracefully (timeout + catch + local-only fallback), which is out of scope for this plan.
- Manual verification (connecting a real bunker and confirming it prompts for kind-30078 + NIP-44) is deferred to `/gsd-verify-work` per the plan's `<verification>` section — this requires a live NIP-46 signer session not available in this execution environment.

---
*Phase: 02-save-notification-preferences-as-encrypted-1xxxx-nostr-event*
*Completed: 2026-07-09*

## Self-Check: PASSED

All created/modified files verified present on disk; all four commit hashes (c17327c, 6f3fea0, 955f985, ba55db5) verified present in git log.
