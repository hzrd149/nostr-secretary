---
phase: 03-review-and-add-nip-04-dm-support-per-applesauce-docs
fixed_at: 2026-07-10T04:14:10Z
review_path: .planning/phases/03-review-and-add-nip-04-dm-support-per-applesauce-docs/03-REVIEW.md
iteration: 2
findings_in_scope: 1
fixed: 1
skipped: 0
status: all_fixed
---

# Phase 3: Code Review Fix Report

**Fixed at:** 2026-07-10T04:14:10Z
**Source review:** .planning/phases/03-review-and-add-nip-04-dm-support-per-applesauce-docs/03-REVIEW.md
**Iteration:** 2

**Summary:**
- Findings in scope: 1 (WR-01 -- `fix_scope: critical_warning`; there are 0 Critical/Blocker findings in this re-review, and IN-01 was out of scope for this run)
- Fixed: 1
- Skipped: 0

`bun test` (68 pass / 0 fail, up from 65 pass at baseline) and `bun run lint` (`tsc --noEmit`, clean) were re-run after the fix and pass.

## Fixed Issues

### WR-01: A profile-lookup timeout now produces a notification titled literally "undefined sent you a message"

**Files modified:** `notifications/legacy-messages.ts`, `notifications/messages.ts`, `tests/notifications/legacy-messages.test.ts`
**Commit:** `6df2af7`
**Applied fix:** The prior iteration's WR-01 fix correctly made `decryptLegacyDirectMessage` swallow a `getProfile` rejection into `profile: undefined` rather than throwing, but that surfaced this newly-reachable UI defect: `getDisplayName(profile)` in `notifications/messages.ts`'s NIP-04 subscribe callback has no npub auto-fallback when given a bare `ProfileContent | undefined` (that auto-fallback only triggers for a full signed `NostrEvent` argument), so `profile: undefined` rendered the literal string `"undefined sent you a message"` in a user-facing push notification title.

Added a new exported pure helper, `getMessageDisplayName(profile, sender)`, to `notifications/legacy-messages.ts` (the same network-safe, no-singleton-imports module the WR-04 fix extracted last iteration) that builds the same `npub.slice(0, 9) + "…" + npub.slice(-4)` fallback applesauce's own `getDisplayName` uses internally for signed events, and passes it as `getDisplayName`'s explicit `fallback` argument:

```ts
export function getMessageDisplayName(
  profile: ProfileContent | undefined,
  sender: string,
): string {
  const npub = npubEncode(sender);
  const fallback = npub.slice(0, 5 + 4) + "…" + npub.slice(-4);
  return getDisplayName(profile, fallback) ?? fallback;
}
```

Wired this into `notifications/messages.ts`'s NIP-04 subscribe callback only (`const displayName = getMessageDisplayName(profile, sender);`), replacing the bare `getDisplayName(profile)` call at that one site. The NIP-17 path (`notifications/messages.ts:233`, gift-wrap subscribe callback) was deliberately left untouched -- the review noted this defect is specific to the NIP-04 path because only that path deliberately swallows a profile-lookup failure and continues; `replies.ts`, `zaps.ts`, and `groups.ts` were also left untouched per the review's own scoping and this run's constraints.

Added 3 new regression tests to `tests/notifications/legacy-messages.test.ts` covering `getMessageDisplayName` directly (no network I/O -- uses a locally `generateSecretKey()`-derived pubkey):
- profile `undefined` falls back to the shortened npub, and the result is asserted to never be (or contain) the literal string `"undefined"`
- profile with `name`/`display_name` set is preferred over the npub fallback
- profile defined but with no name fields still falls back to the shortened npub

This directly closes the gap the review identified and would have caught the literal-`"undefined"`-title regression had it existed beforehand.

## Skipped Issues

None -- the 1 in-scope finding (WR-01) was fixed.

**Out of scope (not attempted, per `fix_scope: critical_warning`):** IN-01 (`migrateConfig`'s `groups` null-guard doesn't catch an array top-level value, `services/config.ts:140-142`) is an Info-severity finding and was intentionally left for a future `--fix --scope all` run or manual follow-up.

---

_Fixed: 2026-07-10T04:14:10Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 2_
