---
phase: 05-dm-notifications-split-contacts-and-others-categories
plan: 01
subsystem: notifications
tags: [rxjs, applesauce, nostr-tools, nip-02, contacts, tdd]

# Dependency graph
requires: []
provides:
  - "contacts$ (services/nostr.ts) -- reactive, no-signer Observable<ProfilePointer[]> of the user's kind-3 follow list"
  - "isContact(pubkey): Promise<boolean> (services/nostr.ts) -- 2s-timeout-to-false follow check"
  - "DmCategory type + classifyDmSender(isFollowed): DmCategory (notifications/dm-category.ts) -- pure sender classifier"
affects: ["05-02 (config schema cutover)", "05-03 (listener category gate)"]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "No-signer reactive accessor: user$.pipe(switchMap(eventStore.<accessor>), shareAndHold()) -- mirrors groups$/mailboxes$, avoids mutedPubkeys$'s signer branch when the underlying kind is never hidden-tag-decrypted"
    - "Timeout-to-safe-default idiom: firstValueFrom(obs$.pipe(timeout({first:2000, with:()=>of(fallback)}))) -- mirrors isMuted, gives an 'unavailable' fallback for free with zero special-case code"
    - "Pure extracted classifier module with no top-level singleton imports, mirroring notifications/legacy-messages.ts, so it is always safe to import directly in tests"

key-files:
  created:
    - notifications/dm-category.ts
    - tests/notifications/dm-category.test.ts
  modified:
    - services/nostr.ts

key-decisions:
  - "Imported ProfilePointer from applesauce-core/helpers (already imported in services/nostr.ts) instead of nostr-tools directly -- nostr-tools namespaces nip19 exports (export * as nip19), it does not re-export ProfilePointer at the package root, so `import type { ProfilePointer } from \"nostr-tools\"` fails to compile. applesauce-core/helpers/pointers.js re-exports it from nostr-tools/nip19, and the file already imports several other helpers from that same module, so this keeps the import list consolidated."

patterns-established:
  - "Pattern: extracting a pure, network-free classifier module (no singleton imports) alongside its unit test, following notifications/legacy-messages.ts's precedent, for any decision logic that composes I/O results from services/nostr.ts."

requirements-completed: [D5-01, D5-02, D5-03]

coverage:
  - id: D1
    description: "contacts$ is a reactive, no-signer Observable<ProfilePointer[]> of the user's kind-3 follow list, built over user$ + eventStore.contacts()"
    requirement: "D5-01"
    verification:
      - kind: other
        ref: "grep -q 'export const contacts$' services/nostr.ts; grep -q 'eventStore.contacts(' services/nostr.ts; tsc --noEmit (bun run lint)"
        status: pass
    human_judgment: true
    rationale: "Reactive observables (contacts$'s live re-emission on follow-list change, no-signer behavior) are not directly unit-tested in this codebase -- same precedent as groups$/mutedPubkeys$. Live end-to-end classification against a real kind-3 event + real DMs is deferred to human UAT per 05-VALIDATION.md Manual-Only."
  - id: D2
    description: "isContact(pubkey) resolves true iff pubkey is in the follow list, and falls back to false on a 2s load timeout (D5-02 unavailable -> others mechanism)"
    requirement: "D5-02"
    verification:
      - kind: other
        ref: "grep -q 'export async function isContact' services/nostr.ts; tsc --noEmit (bun run lint)"
        status: pass
    human_judgment: true
    rationale: "The 2s-timeout fallback path (a follow list that never loads) requires a live/slow relay scenario to exercise end-to-end; deferred to human UAT per 05-VALIDATION.md Manual-Only, matching isMuted's existing untested-reactive precedent."
  - id: D3
    description: "classifyDmSender(isFollowed) is a pure classifier mapping true->contacts, false->others, with the unavailable->others case explicitly covered"
    requirement: "D5-01"
    verification:
      - kind: unit
        ref: "tests/notifications/dm-category.test.ts#classifyDmSender a followed sender classifies as contacts (D5-01)"
        status: pass
      - kind: unit
        ref: "tests/notifications/dm-category.test.ts#classifyDmSender a non-followed sender classifies as others (D5-01)"
        status: pass
      - kind: unit
        ref: "tests/notifications/dm-category.test.ts#classifyDmSender an unavailable/timed-out follow list also classifies as others (D5-02)"
        status: pass
    human_judgment: false

# Metrics
duration: 6min
completed: 2026-07-10
status: complete
---

# Phase 5 Plan 1: Reactive contacts$/isContact + pure classifyDmSender Summary

**Reactive, no-signer contacts$/isContact(pubkey) added to services/nostr.ts mirroring the groups$/isMuted idioms, plus a pure classifyDmSender(isFollowed) unit in notifications/dm-category.ts with a network-safe test covering contacts/others/unavailable-fallback.**

## Performance

- **Duration:** 6 min
- **Started:** 2026-07-10T13:39:00-05:00
- **Completed:** 2026-07-10T13:40:46-05:00
- **Tasks:** 2 completed (Task 2 executed as TDD: RED -> GREEN)
- **Files modified:** 3 (1 modified, 2 created)

## Accomplishments
- `contacts$` (services/nostr.ts): reactive `Observable<ProfilePointer[]>` of the user's kind-3 NIP-02 follow list, built as `user$.pipe(switchMap((user) => eventStore.contacts(user)), shareAndHold())` -- no signer dependency, since kind 3 is never hidden-tag-decrypted by applesauce (mirrors groups$/mailboxes$'s no-signer shape, not mutedPubkeys$'s signer branch).
- `isContact(pubkey): Promise<boolean>` (services/nostr.ts): mirrors isMuted's `firstValueFrom(contacts$.pipe(timeout({first:2000, with:()=>of([])})))` idiom -- an unresolved follow list and a genuine non-follow both resolve `false`, giving the D5-02 "unavailable -> others" fallback for free.
- `notifications/dm-category.ts` (new): pure `classifyDmSender(isFollowed: boolean): DmCategory` with no top-level singleton imports, safe to import directly in tests.
- `tests/notifications/dm-category.test.ts` (new): unit coverage for true->contacts, false->others, and an explicitly-named unavailable->others case, plus a `DmCategory` union-shape assertion.

## Task Commits

Each task was committed atomically:

1. **Task 1: Add reactive no-signer contacts$ + isContact(pubkey) to services/nostr.ts** - `9a837af` (feat)
2. **Task 2: Add the pure classifyDmSender unit + its network-safe test (TDD)**
   - RED: `bb33e2f` (test) -- failing test written against the not-yet-existing module, confirmed failing (module-not-found) before implementation
   - GREEN: `3373e02` (feat) -- minimal implementation, confirmed all 4 tests pass

**Plan metadata:** (this commit, docs: complete plan)

_Note: Task 2 followed the TDD RED -> GREEN cycle; no REFACTOR commit was needed since the minimal implementation required no cleanup._

## Files Created/Modified
- `services/nostr.ts` - added `contacts$`, `isContact(pubkey)`, and the `ProfilePointer` type import (from `applesauce-core/helpers`); no other observable in the file changed
- `notifications/dm-category.ts` (new) - exports `DmCategory` type and pure `classifyDmSender(isFollowed)` function
- `tests/notifications/dm-category.test.ts` (new) - unit tests for classifyDmSender

## Decisions Made
- **ProfilePointer import source deviation (Rule 1 - bug fix):** the plan's action text specified `import type { ProfilePointer } from "nostr-tools"`, but `nostr-tools`'s package root only re-exports nip19 as a namespace (`export * as nip19 from './nip19.ts'`), not `ProfilePointer` itself -- `tsc --noEmit` failed with `TS2305: Module '"nostr-tools"' has no exported member 'ProfilePointer'`. Fixed by importing `ProfilePointer` as a type from `applesauce-core/helpers` instead (already imported in services/nostr.ts for `hasHiddenTags`/`mergeRelaySets`/`unixNow`; `applesauce-core`'s `helpers/pointers.js` re-exports `ProfilePointer` directly from `nostr-tools/nip19`). This satisfies every acceptance criterion in the plan (the `ProfilePointer` grep check, the type's actual shape, and the verbatimModuleSyntax convention) without introducing a second import statement.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed incorrect ProfilePointer import path**
- **Found during:** Task 1 (`bun run lint`)
- **Issue:** `import type { ProfilePointer } from "nostr-tools"` (as written in the plan) fails to compile -- `nostr-tools`'s top-level index only exports `nip19` as a namespace object, never `ProfilePointer` as a root-level named export.
- **Fix:** Added `ProfilePointer` (as a type) to the existing `applesauce-core/helpers` import in services/nostr.ts, which already re-exports it from `nostr-tools/nip19`.
- **Files modified:** services/nostr.ts
- **Verification:** `bun run lint` (`tsc --noEmit`) clean; `bun test` full suite green (81 pass).
- **Committed in:** `9a837af` (Task 1 commit)

**2. [Out of scope, reverted] bun.lock side-effect from `bun install`**
- **Found during:** pre-Task-1 setup (`node_modules` was absent in this worktree, so `bun install` was run to enable `bun test`/`bun run lint`)
- **Issue:** `bun install` rewrote `bun.lock`'s version-range pins to exact resolved versions (e.g. `"applesauce-core": "^6"` -> `"applesauce-core": "^6.2.0"`), an unrelated formatting/version-pin change out of this plan's scope.
- **Fix:** Reverted `bun.lock` via `git checkout -- bun.lock` after confirming `bun test`/`bun run lint` still passed with `node_modules` installed on disk (the lockfile content doesn't need to change for already-installed packages to resolve).
- **Files modified:** none (reverted, not committed)

---

**Total deviations:** 2 (1 auto-fixed bug, 1 out-of-scope revert)
**Impact on plan:** Both necessary for correctness/scope-cleanliness. No scope creep -- the ProfilePointer fix is a strict subset of the plan's stated import location, and the bun.lock revert keeps the commit history scoped to the plan's `files_modified` list (services/nostr.ts, notifications/dm-category.ts, tests/notifications/dm-category.test.ts).

## Issues Encountered
None beyond the deviations documented above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- `isContact(pubkey)` and `classifyDmSender(isFollowed)` are both exported and ready for Plan 03's category gate to consume unchanged (`classifyDmSender(await isContact(sender))`).
- `bun run lint` and the full `bun test` suite (81 tests, 10 files) are green.
- No blockers for Plan 02 (config schema cutover) or Plan 03 (listener gate wiring) -- this plan touched none of config.ts, preferences.ts, messages.ts, or messages.tsx, per the plan's explicit prohibition.

---
*Phase: 05-dm-notifications-split-contacts-and-others-categories*
*Completed: 2026-07-10*
