---
phase: 05-dm-notifications-split-contacts-and-others-categories
reviewed: 2026-07-10T18:59:07Z
depth: standard
files_reviewed: 10
files_reviewed_list:
  - services/nostr.ts
  - services/config.ts
  - helpers/preferences.ts
  - notifications/dm-category.ts
  - notifications/messages.ts
  - pages/messages.tsx
  - tests/notifications/dm-category.test.ts
  - tests/services/config.test.ts
  - tests/helpers/preferences.test.ts
  - tests/notifications/messages.test.ts
findings:
  critical: 1
  warning: 2
  info: 1
  total: 4
status: issues_found
---

# Phase 5: Code Review Report

**Reviewed:** 2026-07-10T18:59:07Z
**Depth:** standard
**Files Reviewed:** 10
**Status:** issues_found

## Summary

Reviewed the DM-notification contacts/others split: the new no-signer
`contacts$`/`isContact()` reactive pair (services/nostr.ts), the pure
`classifyDmSender` unit (notifications/dm-category.ts), the
`messages.enabled` → `messages.contacts.enabled`/`messages.others.enabled`
config-schema cutover with migration (services/config.ts), the Phase-2
kind-30078 sync extension with old-peer fallback (helpers/preferences.ts),
the layered per-category gate in both DM listeners (notifications/messages.ts),
and the two-section `/messages` UI (pages/messages.tsx). `bun test` (95/95)
and `bun run lint`/`tsc --noEmit` are green.

The reactive contacts pipeline, the sync fallback (`asMessagesCategories`),
and the gate ordering/sender-extraction in `notifications/messages.ts` are
all correct and match their design intent (verified by tracing
`getLegacyMessageCorrespondent`, `ContactsModel`/`getContacts`, and RxJS
`timeout()` semantics against the actual library source, not just reading
the comments).

However, `migrateConfig`'s new D5-06 `messages.enabled` → `contacts`/`others`
split is meaningfully less defensive than the `groups` normalization added
in the same function, and I was able to reproduce three distinct crash
scenarios directly from a malformed/partial `config.json` — exactly the
"any config that omits messages or has partial shape must not crash"
requirement this phase called out. This is a Critical finding (CR-01). Two
Warnings and one Info item round out the review (unguarded `isContact`
rejection path, and a test-coverage/staleness note).

## Critical Issues

### CR-01: `migrateConfig` does not defensively normalize a null/partial/non-object `messages`, unlike the `groups` guard added in the same function — reproducible crashes

**File:** `services/config.ts:164-174` (contrast with the `groups` guard immediately below it, `services/config.ts:180-188`)

**Issue:** The D5-06 split guard only fires when `parsed.messages` is truthy
and `typeof === "object"`, and only backfills `contacts`/`others` when
**both** are `undefined`. Unlike `groups` (which the same function explicitly
normalizes to `{}` when `null`/non-object, with an inline comment citing this
exact class of hand-edited-config risk), `messages` gets no equivalent
normalization. I reproduced three independent crashes by running the exact
migration + merge logic (`config$.next({ ...config$.value, ...parsed })`,
`services/config.ts:199`) against plausible malformed `config.json` inputs:

1. `{"messages": null}` (valid JSON, exactly as plausible as the
   already-guarded `"groups": null` case): the split guard's
   `parsed.messages && typeof parsed.messages === "object"` check is falsy,
   so `parsed.messages` stays `null`. The subsequent
   `config$.next({ ...config$.value, ...parsed })` merge then **overwrites**
   the default `messages` object with `null` (spread includes the literal
   `messages: null` key). Any later `config.messages.contacts.enabled` access
   — e.g. `notifications/messages.ts`'s `enabled$` map
   (`c.messages.contacts.enabled || c.messages.others.enabled`, evaluated
   synchronously on every `config$` emission including the first), or
   `pages/messages.tsx`'s `messagesConfig.contacts.enabled` in its GET
   handler — throws `TypeError: Cannot read properties of null (reading
   'contacts')`. Confirmed via direct repro of the migrate+merge logic:
   `merged.messages` is `null`, and `merged.messages.contacts` throws.

2. `{"messages": {"enabled": true}}` (a legacy shape missing
   `whitelists`/`blacklists` — plausible for a very old or hand-trimmed
   config): the split correctly adds `contacts`/`others`, but
   `whitelists`/`blacklists` are never backfilled, so they stay `undefined`.
   `notifications/messages.ts`'s `shouldNotify()` then throws on the very
   first incoming DM at `if (messages.blacklists.length > 0)`
   (`notifications/messages.ts:55`) — `Cannot read properties of undefined
   (reading 'length')`.

3. `{"messages": {"contacts": {"enabled": true}}}` (a partial new-schema
   config with only one of the two category keys present — e.g. from a
   hand-edit or an interrupted write): the guard requires **both**
   `contacts` and `others` to be `undefined` (`&&`, not independent-per-key),
   so since `contacts` is already defined, the whole split is skipped and
   `others` is never populated. `messages.others.enabled` (read in both DM
   listeners, `notifications/messages.ts:178`/`:245`, and in
   `pages/messages.tsx`'s `checked={messagesConfig.others.enabled}`) throws
   `TypeError: Cannot read properties of undefined (reading 'enabled')`.

None of these three shapes is covered by `tests/services/config.test.ts`,
even though the file explicitly tests the analogous `groups: null` and
`groups` omitted-entirely cases (`WR-03` tests at lines 134-144) — the same
class of defensive test is simply missing for `messages`.

**Fix:** Normalize `messages` the same way `groups` is normalized, and
backfill scalar/array fields independently instead of gating the whole
split on both keys being absent:

```ts
// Normalize a null/non-object top-level `messages` first (mirrors the
// groups guard below), so a corrupted/hand-edited config.json can't crash
// every downstream consumer of messages.contacts/others.
if (parsed.messages == null || typeof parsed.messages !== "object") {
  parsed.messages = {};
}

// D5-06: split the flat messages.enabled into per-category contacts/others
// flags, seeding each missing key independently from the legacy value
// (never require BOTH keys to be absent before backfilling either one).
if (parsed.messages.contacts === undefined || parsed.messages.others === undefined) {
  const legacyEnabled = parsed.messages.enabled === true;
  if (parsed.messages.contacts === undefined)
    parsed.messages.contacts = { enabled: legacyEnabled };
  if (parsed.messages.others === undefined)
    parsed.messages.others = { enabled: legacyEnabled };
}
delete parsed.messages.enabled;

// Backfill any still-missing scalar/array fields so a partial legacy shape
// (e.g. `{ messages: { enabled: true } }` with no whitelists/blacklists)
// can't crash shouldNotify()'s `.length` checks.
if (!Array.isArray(parsed.messages.whitelists)) parsed.messages.whitelists = [];
if (!Array.isArray(parsed.messages.blacklists)) parsed.messages.blacklists = [];
if (typeof parsed.messages.sendContent !== "boolean") parsed.messages.sendContent = false;
```

Add matching unit tests mirroring the existing `groups: null` /
`groups` omitted coverage (lines 134-144 of the test file).

## Warnings

### WR-01: `await isContact(sender)` unguarded in both DM listener `.subscribe()` callbacks — a non-timeout error becomes a silent unhandled rejection instead of a logged failure

**File:** `notifications/messages.ts:177` and `notifications/messages.ts:244`

**Issue:** Both listeners do
`const category = classifyDmSender(await isContact(sender));` directly
inside their `.subscribe(async (...) => {...})` callback, with no
try/catch. `isContact` (`services/nostr.ts:357-365`) uses
`contacts$.pipe(timeout({ first: 2000, with: () => of([]) }))` — the
`with` fallback only intercepts RxJS's `TimeoutError`; if the underlying
`eventStore.contacts(user)` observable instead *errors* (rather than merely
being slow), that error propagates straight through `firstValueFrom` and
`isContact` rejects. Every other failure path in this same file (NIP-04
decrypt failure, NIP-17 gift-wrap unlock failure, profile-lookup timeout) is
deliberately caught and routed through the module's structured `log(...)`
helper with contextual fields; this one instead becomes a generic unhandled
promise rejection, caught only by the process-wide `unhandledRejection`
handler in `index.ts:67` (`console.error("Unhandled rejection:", error)`),
with no `sender`/`event` context and the notification silently dropped.

**Fix:**
```ts
let isFollowed = false;
try {
  isFollowed = await isContact(sender);
} catch (error) {
  log("Failed to resolve contact status, treating as others", {
    sender,
    error: error instanceof Error ? error.message : String(error),
  });
}
const category = classifyDmSender(isFollowed);
```
Apply the same wrap to both the NIP-04 and NIP-17 listener call sites.

### WR-02: The D5-07 layered-gate wiring in production code has no automated coverage — only a local "mirror" function is tested

**File:** `tests/notifications/messages.test.ts:201-268`; production code at `notifications/messages.ts:174-189` and `:238-258`

**Issue:** `passesCategoryGate` in the test file is a hand-written mirror of
`messages[category].enabled`, and the sibling `decide()` mirror likewise
reproduces `shouldNotify`'s gate order — neither imports or exercises the
actual `.subscribe()` callbacks in `notifications/messages.ts` (by design,
to avoid the self-subscribing singleton's network I/O — this is called out
in the file's own `TODO(WR-04)` comment). This means a future refactor that
reorders the category gate after `shouldNotify`, drops it entirely, or wires
the wrong sender variable (e.g. accidentally using the gift-wrap's random
one-time pubkey instead of `rumor.pubkey`) would keep `bun test` green while
silently regressing the exact behavior (D5-07 gate ordering) this phase was
built to guarantee.

**Fix:** No action required to ship this phase (the gap is pre-existing and
already tracked via the `TODO(WR-04)` comment), but this should stay a
tracked follow-up rather than be considered resolved by the mirror tests.
Consider a lightweight integration test that stubs `pool`/`eventStore` at
the module boundary (or extracts the gate+shouldNotify sequence into an
exported, directly-testable function) so the real wiring gets exercised.

## Info

### IN-01: `messages` config snapshot taken before `await isContact()` can be stale for the in-flight notification

**File:** `notifications/messages.ts:174` and `notifications/messages.ts:238`

**Issue:** Both listeners call `const { messages } = getConfig();` (or
destructure `messages` alongside `pubkey`) *before* `await isContact(sender)`,
then read `messages[category].enabled` afterward. If the user toggles a
category's enabled flag via the `/messages` UI during that await window
(typically sub-millisecond, up to 2s if `isContact`'s timeout fallback
fires), the gate decision uses the pre-await config snapshot rather than the
config in effect when the decision is actually made.

**Fix:** Low priority given the narrow window and low stakes (worst case:
one notification uses the setting from a moment ago), but if strict
freshness is desired, re-read `getConfig()` (or just the `messages` field)
after the `await isContact(...)` call rather than before it.

---

_Reviewed: 2026-07-10T18:59:07Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
