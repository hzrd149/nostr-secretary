---
phase: 01-nip-29-group-notification-modes
verified: 2026-07-07T23:15:00Z
status: human_needed
score: 10/10 must-haves verified (code + automated tests); 2 items require human visual/interaction verification with a live signer
behavior_unverified: 0
overrides_applied: 0
human_verification:
  - test: "On /groups, with a signer that has joined ≥1 real NIP-29 group, load the page and visually confirm each joined group renders a row with avatar (or 👥 placeholder), name (or 'Unnamed group'), a mode badge, and a mode dropdown preset to the group's current effective mode."
    expected: "Each joined group appears as a correctly laid-out row; a user with zero groups sees the empty-state message instead."
    why_human: "Requires a live signer session with actual NIP-29 group membership (kind 10009 list); no Playwright harness exists this phase. Code path was only exercised with an empty joined-groups list during automated/curl smoke testing (per 01-04-SUMMARY.md coverage item D1)."
  - test: "On /groups, change a group's mode dropdown, click 'Save Group Settings', then reload /groups and confirm the dropdown retains the saved value; inspect config.json to confirm the encodeGroupPointer key was written with the chosen mode."
    expected: "The dropdown shows the persisted mode after reload; config.json's groups.modes has exactly the expected key/value with no unexpected keys."
    why_human: "Requires a live signer session with ≥1 joined group to exercise the full save → reload round trip; not exercised in the execution session per 01-04-SUMMARY.md coverage item D6 (status: unknown, human_judgment: true)."
---

# Phase 01: NIP-29 group notification modes Verification Report

**Phase Goal:** Add per-group notification mode settings (all messages, only @mention, muted) for NIP-29 groups, including a NIP-29 groups section in the notifications settings view.
**Verified:** 2026-07-07T23:15:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

This project has no formal REQUIREMENTS.md; requirement decisions D-01..D-10 are documented in `01-CONTEXT.md` and were cross-referenced against each plan's `requirements:` frontmatter (all 10 IDs are claimed across the 5 plans, no orphans — see Requirements Coverage below).

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `getGroupMode` returns stored mode / default `"mentions"` for unknown group (D-01/D-06) | ✓ VERIFIED | `helpers/groups.ts:69-74`; `tests/helpers/groups.test.ts` `getGroupMode` describe block (2 tests, pass) |
| 2 | `passesGroupModeGate`: false for muted, true for all, `messageMentionsPubkey(...)` for mentions (D-01) | ✓ VERIFIED | `helpers/groups.ts:53-66` exhaustive switch; 4 tests pass in `tests/helpers/groups.test.ts` |
| 3 | `messageMentionsPubkey`: true on p-tag OR nostr: content mention, false otherwise (D-02) | ✓ VERIFIED | `helpers/groups.ts:40-50` uses `getContentPointers`/`getPubkeyFromDecodeResult` from `applesauce-core/helpers` (no hand-rolled regex, confirmed via grep); 4 tests pass |
| 4 | `summarizeGroupModes` returns `{all, mentions, muted}` counts (D-05) | ✓ VERIFIED | `helpers/groups.ts:77-83`; 2 tests pass |
| 5 | `isGroupNotificationMode` ASVS V5 validator narrows/rejects (D-01 support) | ✓ VERIFIED | `helpers/groups.ts:86-90`; 2 tests pass; consumed by `pages/groups.tsx` PATCH (line 310) |
| 6 | `AppConfig.groups.modes: Record<string, GroupNotificationMode>` persisted, type-only imported (D-10) | ✓ VERIFIED | `services/config.ts:6` (`import type`), `:54` field, `:85` BehaviorSubject default `modes: {}` |
| 7 | Fresh install boots with `groups.modes === {}`; existing config.json (no `modes` key) backfills to `{}` (D-06/D-10, Pitfall 1) | ✓ VERIFIED | `services/config.ts:108-111` backfill runs before the shallow `config$.next({...config$.value, ...parsed})` spread at line 113; proven by `tests/services/config.test.ts` against `tests/fixtures/config-pre-modes.json` (fixture confirmed has `groups` with no `modes` key) |
| 8 | Per-group modes round-trip through `config$`/`getConfig()` (D-10) | ✓ VERIFIED | `tests/services/config.test.ts` round-trip test passes |
| 9 | CHANGELOG.md documents the D-07 quieter-by-default behavior change | ✓ VERIFIED | `CHANGELOG.md:3-6` — new "Unreleased" entry states existing users drop to mentions-only until switched back to "All messages" |
| 10 | Master switch `groups.enabled` still gates all group notifications; OFF ⇒ no notify regardless of mode (D-08) | ✓ VERIFIED | `notifications/groups.ts:98-100,116` — `enabled$` combines `config$`+`groups$`; `switchMap` returns `NEVER` when disabled (structural gate, upstream of mode gate) |
| 11 | Per-group mode gate runs between master switch and `shouldNotify` sender gate: muted⇒drop, mentions⇒drop unless mention, all⇒continue (D-01/D-06/D-09 step 2) | ✓ VERIFIED | `notifications/groups.ts:119-129` — gate is the first logic in `.subscribe()`, before `shouldNotify` call at line 131 |
| 12 | Existing `shouldNotify` sender gate (mute/whitelist/blacklist) runs unchanged after the mode gate (D-09 step 3) | ✓ VERIFIED | `git show 351cfbf` diff shows `shouldNotify` (lines 41-69) untouched, only an insertion above the existing call; `git diff` of `notifications/messages.ts`, `notifications/replies.ts`, `notifications/zaps.ts` across the phase is empty (siblings untouched) |
| 13 | D-09 full decision truth table (7 rows) holds | ✓ VERIFIED | `tests/notifications/groups.test.ts` — 7 tests, all pass, composed from the real `passesGroupModeGate` export |
| 14 | `/groups` renders one row per joined group with picture+name+mode dropdown, preselected to current effective mode (D-03/D-04) | ✓ VERIFIED (code) / present-not-visually-confirmed | `pages/groups.tsx:176-228` — `.map((group, index) => ...)` renders avatar/placeholder, name/"Unnamed group" fallback, `MODE_BADGE` colored badge, and `<select data-bind={mode_${index}}>` with `selected={mode === ...}`. See Human Verification #1 — full non-empty-list rendering with a real signer not exercised. |
| 15 | Mode status badge colored per UI-SPEC triples (D-03) | ✓ VERIFIED | `pages/groups.tsx:37-44` `MODE_BADGE` constant exact hex match: all `#d4edda/#155724/#c3e6cb`, mentions `#fff3cd/#856404/#ffeaa7`, muted `#f8d7da/#721c24/#f5c6cb` |
| 16 | Metadata missing/timeout still renders a functional row with fallback (Pitfall 3) | ✓ VERIFIED | `pages/groups.tsx:177-206` — `meta?.picture`/`meta?.name` optional-chained with fallback glyph/"Unnamed group"; `getGroupMetadata` (helpers/groups.ts:21-25) has a 2s timeout→undefined fallback |
| 17 | Zero joined groups ⇒ empty-state message (UI-SPEC) | ✓ VERIFIED | `pages/groups.tsx:155-170` conditional renders "No groups joined yet" block |
| 18 | Saving persists modes into `config.groups.modes` keyed by `encodeGroupPointer`, preserving sibling fields (D-01/D-06) | ✓ VERIFIED | `pages/groups.tsx:296-325` PATCH rebuilds `newConfig.groups` including `modes`, `enabled`, `groupLink`, `whitelists`, `blacklists` |
| 19 | PATCH rejects non-enum mode values before writing (ASVS V5 / T-01-01) | ✓ VERIFIED | `pages/groups.tsx:306-313` — `if (isGroupNotificationMode(raw))` guards every write |
| 20 | `/notifications` Groups card shows per-mode summary via `summarizeGroupModes` (D-05) | ✓ VERIFIED | `pages/notifications.tsx:228-232,296-318` computes `groupModeSummary` and renders counts |
| 21 | Summary counts color-coded per UI-SPEC (D-05) | ✓ VERIFIED | `pages/notifications.tsx:83-96` `.mode-count.all/.mentions/.muted` CSS classes with exact hex `#667eea`/`#856404`/`#721c24` |
| 22 | Groups card still links to `/groups` and shows enabled/disabled status (D-05, no regression) | ✓ VERIFIED | `pages/notifications.tsx:320-328` unchanged `groupsEnabled` status span + `<a href="/groups">Configure</a>` |
| 23 | Zero joined groups ⇒ "No groups joined yet" instead of `0·0·0` on `/notifications` | ✓ VERIFIED | `pages/notifications.tsx:304-317` — `totalGroupModes > 0` ternary |

**Score:** 23/23 code-and-test-backed truths VERIFIED. 2 additional items (full non-empty-list visual rendering, and save→reload persistence round trip) require a live NIP-29 signer session and are routed to Human Verification below — these were also explicitly flagged in `01-04-SUMMARY.md` (its internal coverage IDs D1 and D6, `human_judgment: true`).

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `helpers/groups.ts` | 7 new pure exports + unchanged `getGroupMetadata` | ✓ VERIFIED | All 7 exports present (`GroupNotificationMode`, `DEFAULT_GROUP_NOTIFICATION_MODE`, `messageMentionsPubkey`, `passesGroupModeGate`, `getGroupMode`, `summarizeGroupModes`, `isGroupNotificationMode`); `getGroupMetadata` signature unchanged |
| `tests/helpers/groups.test.ts` | D-01/D-02/D-05/D-06 + validator coverage | ✓ VERIFIED | 15 tests, all pass |
| `services/config.ts` | `modes` field, default, migration backfill | ✓ VERIFIED | All three edits present as specified |
| `tests/services/config.test.ts` | round-trip + migration backfill test | ✓ VERIFIED | 3 tests, all pass |
| `tests/fixtures/config-pre-modes.json` | pre-Phase-1 fixture, no `modes` key | ✓ VERIFIED | File exists, `groups` object has no `modes` key |
| `notifications/groups.ts` | mode gate wired before `shouldNotify` | ✓ VERIFIED | Confirmed via commit diff and current file read |
| `tests/notifications/groups.test.ts` | D-09 7-row truth table | ✓ VERIFIED | 7 tests, all pass |
| `pages/groups.tsx` | async GET list + validated PATCH | ✓ VERIFIED | Both present; badge colors, dropdown, aliasing, ASVS V5 guard all confirmed |
| `pages/notifications.tsx` | Groups card per-mode summary | ✓ VERIFIED | Summary line + color classes present |
| `CHANGELOG.md` | D-07 behavior-change entry | ✓ VERIFIED | "Unreleased" section present |
| `package.json` | `test`: `bun test` script | ✓ VERIFIED | Confirmed present |
| `bunfig.toml` + `tests/setup.ts` | test-process config safety net (not part of original must-haves but required for D-10 tests to be trustworthy) | ✓ VERIFIED | Confirmed wired; real `config.json` byte-verified unaffected |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| `getGroupMode` | `config.groups.modes` map | `encodeGroupPointer(group)` key | ✓ WIRED | Same key function used in `helpers/groups.ts`, `notifications/groups.ts`, and `pages/groups.tsx` PATCH |
| `notifications/groups.ts` subscribe callback | `helpers/groups.ts` | `getGroupMode` + `passesGroupModeGate` calls before `shouldNotify` | ✓ WIRED | Confirmed by direct source read and commit diff |
| `pages/groups.tsx` GET | `pages/groups.tsx` PATCH | shared `getJoinedGroups()` helper (same filter/map chain) | ✓ WIRED | Single shared function, not duplicated — stronger guarantee than the plan required |
| `pages/groups.tsx` PATCH | `services/config.ts` `config$` | `isGroupNotificationMode` guard before write | ✓ WIRED | Confirmed guard present at write site |
| `pages/notifications.tsx` | `helpers/groups.ts` | `summarizeGroupModes(config$.getValue().groups.modes ?? {})` | ✓ WIRED | Confirmed import + call site |
| `services/config.ts` | `helpers/groups.ts` | `import type { GroupNotificationMode }` | ✓ WIRED | Type-only import confirmed, no runtime cycle introduced |

### Behavioral Spot-Checks / Automated Suite

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Full test suite | `bun test` | `25 pass, 0 fail, 36 expect() calls, ran across 3 files` | ✓ PASS |
| Strict typecheck | `bun run lint` (`tsc --noEmit`) | Clean exit, no errors | ✓ PASS |
| Sibling notification modules untouched | `git diff 994dbcf..HEAD -- notifications/messages.ts notifications/replies.ts notifications/zaps.ts` | empty diff | ✓ PASS |
| `shouldNotify` untouched | `git show 351cfbf -- notifications/groups.ts` | Only an insertion above the existing call; function body identical | ✓ PASS |
| Real `config.json` not corrupted by test runs | manual inspection + `.gitignore` check | File present, gitignored, no test artifacts (`wss://groups.example.com'abc123` key) found in it | ✓ PASS |

### Requirements Coverage

| Requirement | Description (01-CONTEXT.md) | Claimed by | Status | Evidence |
|-------------|------------------------------|------------|--------|----------|
| D-01 | Three per-group modes (all/mentions/muted) | Plans 01, 03, 04 | ✓ SATISFIED | `GroupNotificationMode` union + `passesGroupModeGate` + UI dropdown/labels |
| D-02 | @mention = p-tag OR nostr: content mention (OR'd) | Plans 01, 03 | ✓ SATISFIED | `messageMentionsPubkey` short-circuit OR logic, tested |
| D-03 | Per-group controls on `/groups`, existing global controls kept | Plan 04 | ✓ SATISFIED (code) / ⚠ visual pending | Row rendering confirmed in code; full multi-row visual layout with real signer is Human Verification #1 |
| D-04 | Row shows picture+name+mode dropdown from kind 39000 metadata | Plan 04 | ✓ SATISFIED (code) / ⚠ visual pending | Same as D-03 |
| D-05 | `/notifications` Groups card shows per-group mode summary, links to `/groups` | Plans 01, 05 | ✓ SATISFIED | `summarizeGroupModes` + card summary confirmed |
| D-06 | Default mode = "Only @mentions" for all groups (existing + new) | Plans 01, 02, 03, 04 | ✓ SATISFIED | `DEFAULT_GROUP_NOTIFICATION_MODE = "mentions"`, migration backfill, `getGroupMode` fallback |
| D-07 | Quieter-by-default behavior change surfaced (changelog decision) | Plan 02 | ✓ SATISFIED | CHANGELOG.md entry confirmed, no in-app banner/flag added (matches plan's explicit CHANGELOG-only decision) |
| D-08 | Global `groups.enabled` stays master switch, not replaced by per-group modes | Plan 03 | ✓ SATISFIED | `enabled$` gate confirmed structurally upstream of mode gate |
| D-09 | Layering: master switch → mode gate → sender gate → send | Plan 03 | ✓ SATISFIED | Truth table test (7 rows) + source order confirmed |
| D-10 | Config storage shape: `groups.modes` map keyed by `encodeGroupPointer`, survives migration | Plans 02, 04 | ✓ SATISFIED | Field, default, migration, round-trip, orphan-preserving PATCH merge all confirmed |

**No orphaned requirements** — all 10 decision IDs (D-01..D-10) are claimed by at least one plan's `requirements:` frontmatter and are backed by verifiable evidence above.

### Anti-Patterns Found

None. Scanned `helpers/groups.ts`, `services/config.ts`, `notifications/groups.ts`, `pages/groups.tsx`, `pages/notifications.tsx` for `TBD`/`FIXME`/`XXX`/`TODO`/`HACK`/`PLACEHOLDER`/empty-implementation patterns — no matches other than a legitimate HTML `placeholder` attribute in `pages/groups.tsx:134` (input placeholder text, not a debt marker).

### Human Verification Required

Both items below were also independently flagged by the executor in `01-04-SUMMARY.md` (internal coverage IDs D1 and D6, `human_judgment: true`) — this verification confirms they remain unresolved and could not be closed by static/automated analysis.

#### 1. Multi-row visual rendering with a real NIP-29 signer

**Test:** Run `bun run dev`, sign in with a signer that has joined ≥1 real NIP-29 group, open `/groups`.
**Expected:** Each joined group renders a row with avatar (or 👥 placeholder if metadata missing), name (or "Unnamed group"), a color-coded mode badge, and a mode dropdown preselected to the group's current effective mode. A user with zero groups sees the empty-state message.
**Why human:** Requires a live signer session with actual kind 10009 group membership; no Playwright harness exists this phase. Only the empty-list path was exercised via curl smoke test during execution.

#### 2. Save → reload persistence round trip

**Test:** On `/groups` with a joined group, change its mode dropdown, click "Save Group Settings", reload `/groups`, and confirm the dropdown retains the saved value. Inspect `config.json` to confirm the `encodeGroupPointer` key was written with the chosen mode and no unexpected keys exist.
**Expected:** Dropdown shows the persisted mode after reload; `config.json`'s `groups.modes` reflects exactly the saved change.
**Why human:** Requires a live signer with ≥1 joined group to exercise the full round trip through Datastar's client-side reactivity + PATCH + reload; not exercised in the execution session (no such fixture/signer available), and no Playwright config exists this phase.

### Gaps Summary

No gaps found. All 10 requirement decisions (D-01..D-10) and all must-haves across the 5 plans are backed by source code that was directly read and confirmed (not just SUMMARY claims), and by a green automated suite (`bun test`: 25/25 pass; `bun run lint`: clean). The only open items are two pre-flagged human-verification checks that require a live NIP-29 signer session — these were explicitly called out by the executor itself as out of reach for this session's tooling (no Playwright harness this phase) and are not evidence of incomplete implementation; the underlying code paths (rendering logic, PATCH validation, persistence) were directly read and are structurally sound.

---

_Verified: 2026-07-07T23:15:00Z_
_Verifier: Claude (gsd-verifier)_
