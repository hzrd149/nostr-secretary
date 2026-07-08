---
phase: 01-nip-29-group-notification-modes
fixed_at: 2026-07-08T01:08:31Z
review_path: .planning/phases/01-nip-29-group-notification-modes/01-REVIEW.md
iteration: 1
findings_in_scope: 4
fixed: 3
skipped: 1
status: partial
---

# Phase 01: Code Review Fix Report

**Fixed at:** 2026-07-08T01:08:31Z
**Source review:** .planning/phases/01-nip-29-group-notification-modes/01-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 4 (WR-01, WR-02, WR-03, WR-04 -- fix_scope=critical_warning; IN-01/IN-02 intentionally excluded)
- Fixed: 3
- Skipped: 1

Verification performed after each fix and again after all fixes: `bun test` (25 pass / 0 fail, unchanged from baseline) and `bun run lint` (`tsc --noEmit`, zero errors, unchanged from baseline).

## Fixed Issues

### WR-01: `/groups` GET can throw for all groups if any single group's relay metadata fetch errors

**Files modified:** `pages/groups.tsx`
**Commit:** 0dce94f
**Applied fix:** Wrapped each per-group `fetchGroupMetadataEvent(group)` call in the `Promise.all(...)` map with `.catch(() => undefined)`, so an observable-error (as opposed to the already-handled timeout) from one group's relay degrades that single group's metadata to `undefined` (rendered as "Unnamed group") instead of rejecting the whole `Promise.all` and throwing out of `GroupsConfigView()`, which the `GET` route has no try/catch around. Matches the reviewer's suggested fix exactly; code context was unchanged from the review.

### WR-02: Migration only backfills `modes` when `undefined`; invalid persisted shapes can crash mode-dependent code

**Files modified:** `services/config.ts`, `helpers/groups.ts`
**Commit:** ef81747
**Applied fix:**
- `services/config.ts`: broadened the backfill guard from `parsed.groups.modes === undefined` to `parsed.groups.modes == null || typeof parsed.groups.modes !== "object"`, so a hand-edited `"modes": null` or a non-object value is also normalized to `{}` on load, not just an absent key.
- `helpers/groups.ts`: made `getGroupMode` defensive regardless of upstream state -- widened its `modes` parameter to `Record<string, GroupNotificationMode> | undefined | null` and re-validates whatever is read out of the map via the existing `isGroupNotificationMode` guard before returning it, falling back to `DEFAULT_GROUP_NOTIFICATION_MODE` for anything that isn't one of the three literal modes. Since `getGroupMode` is the single choke point both call sites (`pages/groups.tsx:179` and `notifications/groups.ts:124`) go through before a mode value reaches `MODE_BADGE`/`MODE_LABEL` object-key lookups or `passesGroupModeGate`'s switch, this closes off the `TypeError`/silent-`undefined`-return paths described in the finding without needing to touch those call sites or the switch itself.

Both call sites (`pages/groups.tsx:179`, `notifications/groups.ts:124`) were re-read after the change -- they pass `groupsConfig.modes` / `groups.modes` unchanged, which remain structurally compatible with the widened parameter type, and `tsc --noEmit` confirms no type errors were introduced.

### WR-04: `tests/notifications/groups.test.ts` tests a hand-copied re-implementation, not the production code path

**Files modified:** `tests/notifications/groups.test.ts`
**Commit:** bcd55d1
**Applied fix:** Per the finding's own suggested fix ("at minimum, add a comment-linked TODO/tracked follow-up"), added a `TODO(WR-04, tracked follow-up)` comment block above the existing `decide()` mirror documenting the specific coverage gap (zero coverage of the real `.subscribe()` wiring in `notifications/groups.ts`) and the concrete remediation (export the subscribe callback as an independently-callable function with injected `getConfig`/`shouldNotify`/`sendNotification` so it can be unit tested directly). This is a documentation-only change; no test behavior was altered, and `bun test` still shows the same 25 pass / 0 fail.

## Skipped Issues

### WR-03: Positional `mode_${index}` PATCH mapping can silently misassign a mode to the wrong group

**File:** `pages/groups.tsx:293-313`
**Reason:** Skipped -- design change too large to apply safely in this pass, per explicit guidance to document rather than commit a risky partial change.

Investigated switching the per-row `data-bind={`mode_${index}`}` / `signals[`mode_${index}`]` contract to key by group identity (`encodeGroupPointer(group)`) instead of array position, as the finding suggests. Two concrete risks made this unsafe to apply blind in this pass:

1. `encodeGroupPointer` (from `applesauce-common/helpers`) produces strings of the form `` `${hostname}'${id}` `` -- the hostname segment routinely contains dots (e.g. `relay.example.com`), and Datastar (the client-side reactive library driving `data-bind`/`data-on-*` in this codebase, loaded from a CDN `<script>` tag in `components/Document.tsx` rather than vendored in `node_modules`) is documented to treat dots in signal names as nested-path separators. Using the raw or naively-encoded pointer as a signal-name suffix risks the client silently building a nested-object structure instead of the flat `mode_<key>` property the PATCH handler expects to read back with `signals[...]`, which would be a *worse*, less-detectable failure mode than the current index-based race.
2. There is zero existing test coverage of `pages/groups.tsx`'s GET or PATCH handlers (confirmed: no `tests/pages/groups*` file exists), so a change to the data-bind/signal-key contract has no automated way to be verified beyond static type-checking in this environment -- `tsc --noEmit` cannot catch a runtime signal-parsing mismatch against a CDN-loaded client script.

Given the fix touches a live template<->handler wire contract with no test harness to catch a regression and a real risk vector (dotted hostnames colliding with Datastar's own path semantics) that would need its own sanitization/encoding scheme (e.g. base64url or hex encoding the pointer, then updating both the row template and the PATCH `forEach` to use the same encoding) to be done safely, this was left unfixed rather than risk silently breaking group-mode saves. Recommend addressing as a small dedicated follow-up phase/plan with a companion test for the PATCH handler's signal-key round-trip before changing the encoding scheme.

---

_Fixed: 2026-07-08T01:08:31Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
