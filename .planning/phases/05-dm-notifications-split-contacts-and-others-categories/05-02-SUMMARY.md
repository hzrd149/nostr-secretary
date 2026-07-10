---
phase: 05-dm-notifications-split-contacts-and-others-categories
plan: 02
subsystem: config
tags: [config-schema, migration, kind-30078-sync, datastar, typescript]

# Dependency graph
requires:
  - phase: 02-nostr-sync-notification-prefs
    provides: helpers/preferences.ts SyncedPrefs shape + serializePrefs/sanitizeSyncedPrefs/mergePrefs pure functions this plan extends
  - phase: 03-nip04-dm-notifications
    provides: notifications/messages.ts enabled$ + shouldNotify gate this plan's enabled$ one-liner updates
provides:
  - "AppConfig.messages nested schema: contacts.enabled / others.enabled, flat messages.enabled removed entirely"
  - "DEFAULT_MESSAGES_CONFIG exported constant (contacts=true, others=false new-install default, D5-05 corrected)"
  - "migrateConfig idempotent split step seeding both category flags from legacy messages.enabled (D5-06)"
  - "enabled$ two-flag OR gating (contacts.enabled || others.enabled)"
  - "SyncedPrefs.messages carrying contacts/others; PREFS_VERSION=2; asMessagesCategories old-schema-peer fallback (D5-10/Pitfall 5)"
  - "Two-section /messages UI (Contacts/Others) with flat contactsEnabled/othersEnabled Datastar signals"
affects: [05-03-category-gate-wiring]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Config schema split: nested per-category flags with shared cross-category fields, migrated via an idempotent guard in the existing migrateConfig pure function"
    - "Sync schema version bump with an old-schema-payload fallback (seed both new fields from the one legacy field) instead of coercing absent fields to false -- precedent for future PREFS_VERSION bumps"

key-files:
  created: []
  modified:
    - services/config.ts
    - helpers/preferences.ts
    - notifications/messages.ts
    - pages/messages.tsx
    - tests/services/config.test.ts
    - tests/helpers/preferences.test.ts

key-decisions:
  - "New-install default is contacts.enabled=true / others.enabled=FALSE (D5-05 corrected) -- NOT both true as RESEARCH.md's Example 4 showed (that example was stale from a pre-correction draft, per CONTEXT.md's explicit override)"
  - "messages.enabled removed entirely with no derived back-compat field -- enabled$ refactored directly to the two-flag OR to avoid a second, driftable source of truth"
  - "PREFS_VERSION bumped to 2; sanitizeSyncedPrefs's asMessagesCategories helper detects an old-schema peer payload by the ABSENCE of contacts/others keys (not by reading the version number) and seeds both flags from the legacy enabled boolean instead of defaulting to false"
  - "Task 3's UI reshape was folded into Task 1's commit (plan explicitly permits this, since the whole-project tsc requires messages.tsx to compile against the new type by the end of Task 1 regardless)"

patterns-established:
  - "Config schema migrations use an idempotency guard (both new keys absent) inside the shared migrateConfig pure function rather than a one-off external check"
  - "Sync-payload old-schema fallback: detect absence of new fields, not a version-number branch, so the fallback works even if a payload's version field is spoofed or missing"

requirements-completed: [D5-04, D5-05, D5-06, D5-08, D5-10]

coverage:
  - id: D1
    description: "AppConfig.messages reshaped to nested contacts/others.enabled with flat messages.enabled removed; DEFAULT_MESSAGES_CONFIG exported with the corrected D5-05 default (contacts=true, others=false)"
    requirement: "D5-04, D5-05"
    verification:
      - kind: unit
        ref: "tests/services/config.test.ts#services/config DEFAULT_MESSAGES_CONFIG > new-install default is contacts.enabled:true / others.enabled:false"
        status: pass
    human_judgment: false
  - id: D2
    description: "migrateConfig idempotently seeds both category flags from the legacy messages.enabled for existing users; getConfig().messages reflects the migrated pre-modes fixture"
    requirement: "D5-06"
    verification:
      - kind: unit
        ref: "tests/services/config.test.ts#services/config migrateConfig > splits an existing flat messages.enabled:true/false into both category flags, idempotency test"
        status: pass
      - kind: unit
        ref: "tests/services/config.test.ts#services/config groups.modes > migrates the pre-modes fixture's flat messages.enabled:false to contacts/others both false (D5-06)"
        status: pass
    human_judgment: false
  - id: D3
    description: "enabled$ gates on the two-flag OR (c.messages.contacts.enabled || c.messages.others.enabled); notifications/messages.ts touched only for this one-liner"
    requirement: "D5-04"
    verification:
      - kind: unit
        ref: "bun run lint (whole-project tsc) + full bun test suite -- enabled$ compiles and all 86 tests pass"
        status: pass
    human_judgment: false
  - id: D4
    description: "kind-30078 sync carries messages.contacts/others; PREFS_VERSION=2; old-schema peer payload (no contacts/others keys) seeds both flags from legacy enabled instead of coercing to false"
    requirement: "D5-10"
    verification:
      - kind: unit
        ref: "tests/helpers/preferences.test.ts#sanitizeSyncedPrefs > old-schema payload (messages.enabled:true/false, no contacts/others keys) seeds BOTH category flags (Pitfall 5/T-5-04)"
        status: pass
      - kind: unit
        ref: "tests/helpers/preferences.test.ts#sanitizeSyncedPrefs > contacts/others round-trip: serialize -> sanitize reproduces both category flags independently (D5-10)"
        status: pass
    human_judgment: false
  - id: D5
    description: "/messages renders two labeled sections (Contacts/Others) with flat contactsEnabled/othersEnabled Datastar signals; PATCH handler reads both and writes the nested shape; sendContent + WhitelistBlacklist stay shared"
    requirement: "D5-08"
    verification:
      - kind: unit
        ref: "grep verification: data-bind=\"contactsEnabled\", data-bind=\"othersEnabled\", messagesConfig.contacts.enabled, messagesConfig.others.enabled all present in pages/messages.tsx"
        status: pass
    human_judgment: true
    rationale: "Full visual/interactive confirmation that the two-section UI renders correctly, saves both toggles, and round-trips on reload requires a running web UI and live signer session -- deferred to /gsd-verify-work per 05-VALIDATION.md's Manual-Only classification."

# Metrics
duration: 7min
completed: 2026-07-10
status: complete
---

# Phase 5 Plan 2: Config-Schema Cutover Summary

**Atomic `messages.enabled` -> `messages.contacts.enabled`/`messages.others.enabled` split across all 6 readers, with a corrected contacts-on/others-off new-install default, an idempotent migration, and a PREFS_VERSION=2 kind-30078 sync fallback that never silently double-disables a rolling-upgrade peer.**

## Performance

- **Duration:** 7 min
- **Started:** 2026-07-10T18:36:21Z
- **Completed:** 2026-07-10T18:43:34Z
- **Tasks:** 3 (Task 3's UI work landed inside Task 1's commit; Task 2 landed separately)
- **Files modified:** 6

## Accomplishments
- `AppConfig.messages` reshaped to `{ contacts: { enabled }, others: { enabled }, sendContent, whitelists, blacklists }` with the flat `enabled` field removed entirely (no derived back-compat field) -- all 6 production readers (`notifications/messages.ts`, `pages/messages.tsx` x2, `helpers/preferences.ts` x3) plus both test files migrated in the same commit so the whole-project `tsc` stayed green throughout.
- `DEFAULT_MESSAGES_CONFIG` exported with the corrected D5-05 new-install default: `contacts.enabled=true`, `others.enabled=FALSE` (anti-spam-by-default for strangers) -- explicitly overriding RESEARCH.md's stale Example 4 (`others: true`) per CONTEXT.md's correction.
- `migrateConfig` gained an idempotent split step: guards on both `contacts`/`others` being absent, seeds both from the pre-existing `messages.enabled`, deletes the flat field -- existing users' behavior is preserved on upgrade (D5-06), and re-running migration on an already-split config is a no-op.
- `enabled$` refactored directly to `c.messages.contacts.enabled || c.messages.others.enabled` (D5-04) -- the DM listeners stay enabled while either category is on.
- `helpers/preferences.ts`'s `SyncedPrefs.messages`/`serializePrefs`/`sanitizeSyncedPrefs`/`mergePrefs` extended to carry both category flags; `PREFS_VERSION` bumped to 2; a new `asMessagesCategories` coercer detects an old-schema peer payload (absence of `contacts`/`others` keys, not a version check) and seeds BOTH flags from the legacy `enabled` boolean instead of silently coercing to `false` (D5-10, Pitfall 5/T-5-04) -- `sendContent` remains local-only and never enters the synced payload.
- `/messages` now renders two labeled sections (Contacts / Others), each with its own checkbox bound to flat `contactsEnabled`/`othersEnabled` Datastar signals (never dotted paths, Pitfall 4); the shared `sendContent` toggle and `WhitelistBlacklist` component are unchanged below; the PATCH handler reads both flat signals and writes the nested `messages` shape.

## Task Commits

Each task was committed atomically:

1. **Task 1: Atomic schema cutover -- reshape AppConfig.messages across all 6 readers + config migration/default tests** - `72a584b` (feat) -- includes the `messages.tsx` GET/PATCH reshape (Task 3's substance), per the plan's explicit allowance to fold it in so the whole-project typecheck stays green throughout Task 1.
2. **Task 2: Extend kind-30078 sync for the two category flags + PREFS_VERSION bump + old-schema fallback** - `6200f07` (feat)
3. **Task 3: Two-section /messages UI with flat contactsEnabled/othersEnabled signals** - landed inside `72a584b` (see Deviations below); verified independently against Task 3's own acceptance criteria and grep checks.

_Note: no TDD RED/GREEN split was needed -- `tdd="true"` tasks here mean "behavior-then-test" via the `<behavior>` blocks, verified by running the extended test files after each change, not a strict red-first cycle, since the schema reshape and its tests were authored together as one atomic cutover per the plan's own instructions._

## Files Created/Modified
- `services/config.ts` - `AppConfig.messages` reshaped (contacts/others nested, flat `enabled` removed); `DEFAULT_MESSAGES_CONFIG` exported; `migrateConfig` gained the idempotent D5-06 split step
- `helpers/preferences.ts` - `SyncedPrefs.messages` reshaped; `PREFS_VERSION` bumped to 2; `asMessagesCategories` old-schema-peer fallback wired into `sanitizeSyncedPrefs`; `serializePrefs`/`mergePrefs` updated
- `notifications/messages.ts` - `enabled$`'s map expression is now the two-flag OR (only line touched, per plan's explicit scope limit -- category gate deferred to Plan 03)
- `pages/messages.tsx` - two-section Contacts/Others UI with flat `contactsEnabled`/`othersEnabled` signals; PATCH handler reads both and writes the nested shape; shared `sendContent`/`WhitelistBlacklist` unchanged
- `tests/services/config.test.ts` - D3-04 assertions updated to the new nested shape; new cases for `DEFAULT_MESSAGES_CONFIG`, migration (true/false split, idempotency), and the pre-modes fixture's migrated state
- `tests/helpers/preferences.test.ts` - `makeConfig` fixture + all assertions updated to the nested shape; new cases for the contacts/others round-trip, `PREFS_VERSION===2`, and the old-schema-payload fallback (both `enabled:true` and `enabled:false`)

## Decisions Made
- Kept the nested nested-object layout (`messages.contacts.enabled` / `messages.others.enabled`) over a flat `contactsEnabled`/`othersEnabled`-at-messages-level layout, per RESEARCH.md's recommendation and to map 1:1 onto the two UI sections and the `SyncedPrefs` extension.
- Removed `messages.enabled` entirely rather than keeping it as a derived field, eliminating a second potentially-stale source of truth for `enabled$`.
- `asMessagesCategories` keys its old-schema detection off the ABSENCE of `contacts`/`others` keys rather than the payload's `version` number -- more robust against a stale peer that happens to stamp a newer version number without actually including the new fields.

## Deviations from Plan

### Auto-fixed Issues

None requiring Rule 1/2/3 fixes -- the plan's own instructions already anticipated and explicitly authorized the one structural deviation below (not a bug/gap fix, so not one of the numbered deviation rules; documented here for commit-history clarity).

**1. Task 3's UI substance folded into Task 1's commit**
- **Found during:** Task 1 (planning the atomic cutover)
- **Issue:** The plan's own Task 1 action text says: "the full substance of messages.tsx is Task 3 -- but both MUST at least compile against the new type by the end of THIS task... To keep this task self-contained and lint-green, perform the preferences.ts reshape and the messages.tsx reshape in THIS task as the cutover, then Tasks 2 and 3 ADD the dedicated regression tests." Since `pages/messages.tsx` has no dedicated test file to defer, Task 3's full UI substance (two-section markup + PATCH handler) was implemented as part of Task 1's commit, matching the plan's explicit instruction.
- **Fix:** N/A -- this is the plan-directed approach, not an ad hoc fix.
- **Files modified:** `pages/messages.tsx` (within commit `72a584b`)
- **Verification:** Task 3's own `<verify>` grep checks (`data-bind="contactsEnabled"`, `data-bind="othersEnabled"`, `messagesConfig.contacts.enabled`, `messagesConfig.others.enabled`) all pass against the state after `72a584b`, independently re-confirmed after `6200f07`.
- **Commit:** `72a584b`

---

**Total deviations:** 0 auto-fixed (Rules 1-3); 1 plan-directed task-boundary consolidation (explicitly authorized by the plan text itself, not a deviation rule).
**Impact on plan:** None -- all three tasks' acceptance criteria and verification blocks are independently satisfied; no scope creep.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- The `messages.contacts`/`messages.others` config shape is stable, migrated, synced, and rendered -- ready for Plan 03 (Wave 2) to layer the category gate (`classifyDmSender`/`isContact`) into both DM listeners in `notifications/messages.ts` against this now-proven schema.
- `bun run lint` (whole-project tsc) and full `bun test` (86 tests, 166 assertions) are green.
- Manual UAT deferred per 05-VALIDATION.md Manual-Only classification: the two-section UI saving/reloading both toggles and a live kind-30078 sync carrying both flags across two devices requires a running web UI and live signer session, not available in this non-interactive execution context.

---
*Phase: 05-dm-notifications-split-contacts-and-others-categories*
*Completed: 2026-07-10*

## Self-Check: PASSED

- FOUND: services/config.ts
- FOUND: helpers/preferences.ts
- FOUND: notifications/messages.ts
- FOUND: pages/messages.tsx
- FOUND: tests/services/config.test.ts
- FOUND: tests/helpers/preferences.test.ts
- FOUND commit: 72a584b (Task 1 + Task 3 UI cutover)
- FOUND commit: 6200f07 (Task 2 sync extension)
- `bun run lint` clean; full `bun test` green (86 pass, 0 fail, 166 expect() calls)
