---
phase: 05-dm-notifications-split-contacts-and-others-categories
fixed_at: 2026-07-10T19:08:02Z
review_path: .planning/phases/05-dm-notifications-split-contacts-and-others-categories/05-REVIEW.md
iteration: 1
findings_in_scope: 3
fixed: 3
skipped: 0
status: all_fixed
---

# Phase 5: Code Review Fix Report

**Fixed at:** 2026-07-10T19:08:02Z
**Source review:** .planning/phases/05-dm-notifications-split-contacts-and-others-categories/05-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 3 (CR-01, WR-01, WR-02 -- `fix_scope: critical_warning`)
- Fixed: 3
- Skipped: 0

`bun test` (104/104, up from 95 -- 9 new regression/coverage tests added) and
`bun run lint` (`tsc --noEmit`) are green after all three fixes.

## Fixed Issues

### CR-01: `migrateConfig` does not defensively normalize a null/partial/non-object `messages`

**Files modified:** `services/config.ts`, `tests/services/config.test.ts`
**Commit:** f2ce47a
**Applied fix:** Added a `messages == null || typeof !== "object"` normalization
guard in `migrateConfig` (mirroring the existing `groups` guard), replacing a
malformed top-level `messages` with a deep copy of `DEFAULT_MESSAGES_CONFIG`
(`structuredClone`, so the shared constant can never be aliased/mutated by a
later `config$.next()`). Reworked the `contacts`/`others` split guard to
backfill each missing key **independently** (no longer requiring both to be
absent) -- when a legacy `messages.enabled` flag is present, any missing key
inherits its value (D5-06 parity); otherwise each missing key falls back to
its own D5-05 default (contacts:true / others:false) rather than assuming
legacy semantics. This is slightly more precise than the REVIEW.md fix
snippet's single shared `legacyEnabled` value, which would have incorrectly
defaulted a missing `contacts` key to `false` in a legacy-flag-free partial
config. Also backfills `whitelists`/`blacklists` (to `[]`) and `sendContent`
(to `false`) if missing, so `shouldNotify()`'s `.length` checks and the
`sendContent` gate can't crash on a partial legacy shape.

Added 6 new regression tests in `tests/services/config.test.ts` covering all
three crash shapes from the review (`messages: null`, non-object `messages`,
missing whitelists/blacklists/sendContent) plus both directions of the
partial-category case (`contacts` present/`others` missing, and vice versa)
to prove the independent-default fallback is symmetric.

### WR-01: `await isContact(sender)` unguarded in both DM listener `.subscribe()` callbacks

**Files modified:** `notifications/messages.ts`
**Commit:** 5b79074
**Applied fix:** Wrapped both call sites (`notifications/messages.ts`, NIP-04
listener and NIP-17 listener) in try/catch exactly as suggested in
REVIEW.md: on a non-timeout rejection from `isContact`, log the failure via
the module's structured `log(...)` helper with `event`/`sender` context and
fall back to `isFollowed = false` (classifying as "others" per D5-02) rather
than letting the promise rejection escape the `async` subscribe callback
unhandled. Per-message subscription isolation is preserved -- the try/catch
is scoped to the single `isContact` call, so one failed classification
cannot kill the listener or affect other in-flight messages.

### WR-02: The D5-07 layered-gate wiring in production code has no automated coverage

**Files modified:** `notifications/dm-notification-gate.ts` (new file),
`notifications/messages.ts`, `tests/notifications/messages.test.ts`
**Commit:** 95a4059
**Applied fix:** Went with the "prefer real coverage" option from the
guidance rather than the no-op/mirror-strengthening fallback. Extracted the
per-message decision (category gate, then `shouldNotify`) out of both DM
listeners into a new, directly-testable, injectable function
`evaluateDmNotificationGates` (`notifications/dm-notification-gate.ts`). The
function takes `shouldNotify` as an injected argument and has zero runtime
dependency on `services/nostr.ts`'s self-subscribing singletons (only a
type-only `AppConfig` import, erased at compile time), so it can be imported
directly from the network-safe test file without risking real network I/O --
unlike `notifications/messages.ts` itself, which the test file's own
top-of-file note explains it must avoid importing.

Both listeners now call this shared function instead of inlining the two
`if` checks, preserving the exact existing log messages/behavior (verified
via the full test suite and a manual read-through of the diff). Added 4 new
tests in `tests/notifications/messages.test.ts` that import and call the
REAL `evaluateDmNotificationGates` (not a mirror) with injected `shouldNotify`
stubs, including one that asserts `shouldNotify` is never invoked once the
category gate has already rejected the sender -- directly proving the D5-07
ordering invariant against production code, not a hand-written copy of it.
The pre-existing mirror tests for `shouldNotify`'s own internal gate order
(isMuted -> blacklist -> whitelist) are left in place and documented as a
separate, still-open `TODO(WR-04)` follow-up, since `shouldNotify` itself
still depends on `services/nostr.ts` singletons and `getConfig()` and cannot
be imported directly without the same self-subscription risk.

## Out of Scope

### IN-01: `messages` config snapshot taken before `await isContact()` can be stale

Per the task instructions, this Info-severity finding is out of
`critical_warning` fix_scope and was not addressed. Low impact (narrow
window, worst case one notification uses a moment-old setting) and the
WR-01 fix (adding a try/catch around the same `await isContact(...)` call)
did not materially change the config-snapshot timing, so it remains a
separate, low-priority follow-up if strict freshness is ever desired.

---

_Fixed: 2026-07-10T19:08:02Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
