---
phase: 01-nip-29-group-notification-modes
reviewed: 2026-07-08T00:34:55Z
depth: standard
files_reviewed: 12
files_reviewed_list:
  - helpers/groups.ts
  - services/config.ts
  - notifications/groups.ts
  - pages/groups.tsx
  - pages/notifications.tsx
  - CHANGELOG.md
  - bunfig.toml
  - package.json
  - tests/setup.ts
  - tests/helpers/groups.test.ts
  - tests/notifications/groups.test.ts
  - tests/services/config.test.ts
findings:
  critical: 0
  warning: 4
  info: 2
  total: 6
status: issues_found
---

# Phase 01: Code Review Report

**Reviewed:** 2026-07-08T00:34:55Z
**Depth:** standard
**Files Reviewed:** 12 (+ tests/fixtures/config-pre-modes.json)
**Status:** issues_found

## Summary

Reviewed the NIP-29 per-group notification mode feature: the 7 pure helpers in `helpers/groups.ts`, the `AppConfig.groups.modes` field and migration backfill in `services/config.ts`, the mode gate wired into the notification pipeline in `notifications/groups.ts`, the `/groups` PATCH handler in `pages/groups.tsx`, the summary card in `pages/notifications.tsx`, and the test-isolation harness (`bunfig.toml` / `tests/setup.ts`).

The core claims hold up: `isGroupNotificationMode` is a real allow-list validator and the PATCH handler correctly gates every `mode_${index}` signal through it before it reaches `config$` (no untrusted string reaches storage). `messageMentionsPubkey` uses `applesauce-core`'s `getContentPointers`/`getPubkeyFromDecodeResult` rather than hand-rolled regex, and correctly checks both the `p`-tag and NIP-19 content references. The mode gate in `notifications/groups.ts` is correctly ordered *after* the `enabled$` master-switch subscription gate (which itself unsubscribes entirely when `groups.enabled` is false, so the new code never even runs in that case) and *before* the sender whitelist/blacklist check, matching the documented D-09 step ordering. The Bun test-preload (`bunfig.toml` → `tests/setup.ts`) does correctly redirect `Bun.env.CONFIG` to a disposable temp file before `services/config.ts` is ever imported (confirmed: `services/nostr.ts` imports `services/config.ts`, and `helpers/groups.ts` imports `services/nostr.ts`, so even the helper-only test files reach the config singleton transitively as the comments claim) — verified the real project `config.json` was untouched after a full `bun test` run.

That said, the migration/read path has real gaps: it only guards against `modes === undefined`, not other falsy/invalid persisted shapes, and nothing downstream re-validates a mode value read back out of `config.json` before using it as an object-key lookup (`MODE_BADGE[mode]`, `MODE_LABEL[mode]`) or a `switch` discriminant (`passesGroupModeGate`). There is also a genuinely new, un-mitigated availability regression: the `/groups` GET handler now awaits `Promise.all` over a per-group relay-metadata fetch with no error handling, so one unreachable group relay can break the page for all groups. The positional `mode_${index}` PATCH design also has a real, if narrow, TOCTOU-style race between GET-time and PATCH-time group ordering. Findings are detailed below.

## Warnings

### WR-01: `/groups` GET can throw for all groups if any single group's relay metadata fetch errors (not just times out)

**File:** `pages/groups.tsx:74-77`, `pages/groups.tsx:261-265`
**Issue:** `GroupsConfigView` now does:
```ts
const joinedGroups = await getJoinedGroups();
const metadataByIndex = await Promise.all(
  joinedGroups.map((group) => fetchGroupMetadataEvent(group)),
);
```
`fetchGroupMetadataEvent` (= `getGroupMetadata` in `helpers/groups.ts`) only guards against a *timeout* (`timeout({ first: 2000, with: () => of(undefined) })`); it has no `catchError` for a relay connection failure/error emission from `pool.relay(group.relay).request(...)`. If any one joined group's relay is unreachable in a way that surfaces as an observable error rather than a timeout, `firstValueFrom` rejects, `Promise.all` rejects, and `GroupsConfigView()` throws. The `GET` route handler has no try/catch:
```ts
GET: async () => {
  return new Response(await GroupsConfigView(), { ... });
},
```
So a single bad group relay can take down the entire `/groups` page (including the "Enable Group Notifications" checkbox and every other group's row), not just that one group's row. This is new behavior introduced by this phase — previously `GroupsConfigView` was synchronous and did not fetch anything from relays.
**Fix:** Wrap each metadata fetch individually so one failure degrades gracefully instead of failing the whole page:
```ts
const metadataByIndex = await Promise.all(
  joinedGroups.map((group) =>
    fetchGroupMetadataEvent(group).catch(() => undefined),
  ),
);
```

### WR-02: Migration only backfills `modes` when it is `undefined`; other invalid persisted shapes crash `getGroupMode`/`getGroupMode`-based UI

**File:** `services/config.ts:108-111`, `helpers/groups.ts:69-74`, `pages/groups.tsx:179-180`, `notifications/groups.ts:124`
**Issue:** The backfill is:
```ts
if (parsed.groups && parsed.groups.modes === undefined) {
  parsed.groups.modes = {};
}
```
This only handles the *documented* legacy shape (key absent). It does not handle `"modes": null` (valid JSON, plausible from a hand-edited `config.json` or a future writer bug) or a non-object value. Unlike `pages/notifications.tsx`, which defensively does `config$.getValue().groups.modes ?? {}`, neither `getGroupMode` (`modes[encodeGroupPointer(group)]`) nor its two call sites (`pages/groups.tsx:179` and `notifications/groups.ts:124`) guard against `modes` being `null`/non-object. A `null` `groups.modes` therefore throws a `TypeError` when rendering `/groups` and, more importantly, throws inside the `async` `.subscribe(...)` callback in `notifications/groups.ts` on every incoming group message — since that callback's promise rejection is never awaited/caught by the RxJS subscription, this becomes a silent unhandled promise rejection for every group message received while the config is in this state, permanently breaking group notifications until the config is fixed.
Separately, even a value that passes the `undefined` check but isn't one of the three literal strings (e.g. hand-edited to `"muted "` with a trailing space, or a value written before the `isGroupNotificationMode` guard existed) will make `passesGroupModeGate`'s `switch` fall through with **no case matching and no `default`**, silently returning `undefined` instead of the declared `boolean` return type, and will make `MODE_BADGE[mode]` / `MODE_LABEL[mode]` in `pages/groups.tsx` evaluate to `undefined`, causing `badge.bg` to throw.
**Fix:** Broaden the backfill guard and/or validate on read:
```ts
if (parsed.groups && (parsed.groups.modes == null || typeof parsed.groups.modes !== "object")) {
  parsed.groups.modes = {};
}
```
and make `getGroupMode` defensive regardless of upstream state:
```ts
export function getGroupMode(
  modes: Record<string, GroupNotificationMode> | undefined | null,
  group: GroupPointer,
): GroupNotificationMode {
  const stored = modes?.[encodeGroupPointer(group)];
  return isGroupNotificationMode(stored) ? stored : DEFAULT_GROUP_NOTIFICATION_MODE;
}
```

### WR-03: Positional `mode_${index}` PATCH mapping can silently misassign a mode to the wrong group if the joined-groups list changes between page load and save

**File:** `pages/groups.tsx:293-313`
**Issue:** The PATCH handler re-derives `joinedGroups` via the same `getJoinedGroups()` helper used at GET time and zips `signals[`mode_${index}`]` onto `joinedGroups[index]` by position. The code comments acknowledge this design ("Pitfall 2") and mitigate the common case (same helper, same filter/map chain), but it does not mitigate the actual race: if the user's kind-10009 group list is updated (new group joined, or reordered — kind 10009 is a replaceable event so a re-publish can change tag order) between when the page was rendered and when "Save Group Settings" is clicked, `getJoinedGroups()` at PATCH time can return a different array than what was rendered, so `signals.mode_0` (chosen by the user for the group that was at index 0 at render time) can silently get written to a *different* group's key at index 0 in the new list. There is no group-identity field (e.g. `encodeGroupPointer(group)`) submitted alongside each `mode_${index}` signal to detect/guard against this.
**Fix:** Submit the group's encoded pointer alongside each mode signal (e.g. a hidden `data-bind` per row, or bake the pointer into the signal name itself: `mode_${encodeURIComponent(encodeGroupPointer(group))}`) instead of relying purely on array position, so the PATCH handler maps by identity rather than by index.

### WR-04: `tests/notifications/groups.test.ts` tests a hand-copied re-implementation, not the production code path

**File:** `tests/notifications/groups.test.ts:38-49`
**Issue:** The file explicitly does not import `notifications/groups.ts` (documented reason: it self-subscribes at import time and isn't mockable without more work) and instead defines a local `decide()` function that "mirrors" the production `.subscribe()` callback's ordering. This gives real coverage of `passesGroupModeGate` in isolation, but zero coverage of the actual wiring in `notifications/groups.ts` — e.g., if a future change swaps the order of the mode gate and the `shouldNotify` sender check, or drops the `!pubkey` guard, or changes how `groups.modes` is read, this test suite will keep passing while the production behavior silently regresses. This is a coverage gap that could mask exactly the kind of ordering bug this phase was designed to prevent (D-09).
**Fix:** At minimum, add a comment-linked TODO/tracked follow-up to introduce a light seam (e.g. export the `.subscribe()` callback as a named, independently-callable function taking `{ group, metadata, message }` plus injected `getConfig`/`shouldNotify`/`sendNotification`) so the real code path can be unit tested instead of only a parallel mirror of it.

## Info

### IN-01: `MODE_LABEL[mode]` text node is rendered without `safe`, unlike the adjacent group-name span

**File:** `pages/groups.tsx:207-211`
**Issue:** `<span style={...}>{MODE_LABEL[mode]}</span>` renders without the `@kitajs/html` `safe` attribute, while the neighboring group-name span correctly uses `safe` for `meta?.name` (untrusted, relay-controlled). In this specific case `MODE_LABEL[mode]` is always one of three fixed internal strings so there's no actual injection vector today, but it's an inconsistency worth normalizing so a future edit that swaps in dynamic/untrusted content here doesn't inherit an unsafe-by-default element.
**Fix:** Add `safe` for consistency: `<span safe style={...}>{MODE_LABEL[mode]}</span>`.

### IN-02: `config.json` on-disk backfill is deferred until the next unrelated save

**File:** `services/config.ts:113-120`
**Issue:** The in-memory `config$.next({ ...config$.value, ...parsed })` call that performs the `modes: {}` backfill happens *before* the `config$.pipe(skip(1)).subscribe(...)` save-on-change subscription is created, so the backfilled value is never itself persisted to `config.json` until some other config change triggers a save. This isn't a functional bug (runtime state is always correct, confirmed by reading the real dev `config.json`, which still lacks a `modes` key and yet the app behaves correctly per `DEFAULT_GROUP_NOTIFICATION_MODE`), but it does mean the on-disk file can silently stay in the "pre-modes" shape indefinitely for a user who never saves any other setting, which could confuse anyone inspecting `config.json` directly or writing external tooling against it.
**Fix:** No action required; documenting for awareness only. If explicit on-disk backfill is desired, force one write after the migration block (`await fs.writeFile(CONFIG_PATH, JSON.stringify(config$.getValue(), null, 2));`) even when `loaded` is true and the parsed shape changed.

---

_Reviewed: 2026-07-08T00:34:55Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
