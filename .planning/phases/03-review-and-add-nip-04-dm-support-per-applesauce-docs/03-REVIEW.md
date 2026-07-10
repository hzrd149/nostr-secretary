---
phase: 03-review-and-add-nip-04-dm-support-per-applesauce-docs
reviewed: 2026-07-09T23:20:00Z
depth: standard
files_reviewed: 9
files_reviewed_list:
  - const.ts
  - notifications/legacy-messages.ts
  - notifications/messages.ts
  - pages/notifications.tsx
  - services/config.ts
  - tests/const.test.ts
  - tests/notifications/legacy-messages.test.ts
  - tests/notifications/messages.test.ts
  - tests/services/config.test.ts
findings:
  critical: 0
  warning: 0
  info: 2
  total: 2
status: clean
---

# Phase 3: Code Review Report (Re-review, iteration 3 -- final)

**Reviewed:** 2026-07-09T23:20:00Z
**Depth:** standard
**Files Reviewed:** 9
**Status:** clean

## Summary

Final re-review scoped narrowly to commit `6df2af7` (the WR-01 display-name-fallback fix that closed the last remaining Warning from iteration 2). `bun test` (68 pass / 0 fail) and `bun run lint` (`tsc --noEmit`, clean) were re-run and are both green.

Verified all four points this iteration was asked to check:

1. **The fix is correct.** `getMessageDisplayName(profile, sender)` (`notifications/legacy-messages.ts:96-103`) builds an explicit npub fallback (`npub.slice(0, 9) + "…" + npub.slice(-4)`) and passes it as `getDisplayName`'s second (`fallback`) argument. Cross-checked against applesauce's actual `getDisplayName` implementation (`node_modules/applesauce-core/dist/helpers/profile.js:45-63`): when `metadata` is falsy, `getDisplayName` returns `fallback` directly; when `metadata` is a bare `ProfileContent` (no `pubkey`/`id`/`sig`), it returns `metadata.display_name || metadata.displayName || metadata.name || fallback`. Since a non-empty `fallback` is now always supplied, the literal `"undefined"` string can no longer reach the notification title in either the timed-out-profile case or the profile-with-no-name-fields case. Confirmed both by reading the code and by the new tests.
2. **NIP-17 path untouched, no plaintext leak.** Diffed `6df2af7` directly: it touches only `notifications/legacy-messages.ts` (new `getMessageDisplayName` export, additive) and `notifications/messages.ts` (one line changed, in the NIP-04 subscribe callback only: `getDisplayName(profile)` -> `getMessageDisplayName(profile, sender)`). The NIP-17 gift-wrap subscribe block (`notifications/messages.ts:195-247`) is byte-for-byte unchanged and still calls plain `getDisplayName(profile)` with no fallback -- that is a separate, pre-existing code path (the `getValue(eventStore.profile(sender))` call there dates to commit `9176ceb`, long before this phase started), not something this fix touches or introduces. `content` (the decrypted plaintext) is untouched by this diff and still only reaches `sendNotification` behind the existing `messages.sendContent ? content : "[content omitted]"` gate at `notifications/messages.ts:188`.
3. **Fallback matches project convention for unknown senders.** The `npub.slice(0, 5 + 4) + "…" + npub.slice(-4)` construction is character-for-character identical to applesauce's own internal fallback convention inside `getDisplayName` (`profile.js:52-53`), and is consistent with the codebase's existing pattern of trusting `event.pubkey` as a valid 32-byte hex value suitable for `npubEncode` without extra validation (see the pre-existing `nip19.npubEncode(event.pubkey)` call in `helpers/link.ts:25`, applied here to `sender`, which for an incoming legacy message resolves to `event.pubkey` via `getLegacyMessageReceiver`). Events on `tagged$` only reach this pipeline via the RelayPool subscription (which requires a valid signature to be stored via `mapEventsToStore`), so `sender` cannot be a malformed value capable of throwing inside `npubEncode` at this call site -- no new crash surface introduced by the fix.
4. **Tests genuinely cover the fix.** Three new tests in `tests/notifications/legacy-messages.test.ts` (`getMessageDisplayName` describe block, lines 151-181) directly exercise: (a) `profile: undefined` never yields the literal string `"undefined"` and matches the exact expected shortened-npub value; (b) a profile with `name`/`display_name` is preferred over the fallback; (c) a profile object with no name fields still falls back to the shortened npub. These assert against real `nip19.npubEncode`-derived values from a real generated keypair, exercising the pure helper directly rather than mocking `getDisplayName`.

No new Critical or Warning findings. Two minor, non-blocking Info items are noted below -- one is a new observation from this iteration, the other is the previously-accepted, explicitly out-of-scope `migrateConfig` array-guard item carried forward for record-keeping only (not re-analyzed per this iteration's instructions).

## Info

### IN-01: `getMessageDisplayName`'s trailing `?? fallback` is unreachable

**File:** `notifications/legacy-messages.ts:102`
**Issue:** `return getDisplayName(profile, fallback) ?? fallback;` -- given applesauce's actual implementation, `getDisplayName(metadata, fallback)` returns `(metadata?.display_name || metadata?.displayName || metadata?.name || fallback)?.trim()` (or `fallback` directly when `metadata` is falsy). Since `fallback` here is always a non-empty string (`npubEncode` output is never empty), the `||` chain always resolves to a truthy string before `.trim()` runs, so `getDisplayName(profile, fallback)` can never actually return `undefined` at this call site. The trailing `?? fallback` is defensive dead code; it does not change behavior and does not affect the correctness of the shipped fix.
**Fix:** Optional simplification: `return getDisplayName(profile, fallback);` (or leave as-is if the team prefers the extra defensiveness against future upstream changes to `getDisplayName`'s contract).

### IN-02 (carried forward, out of scope): `migrateConfig`'s `groups` null-guard doesn't catch an array top-level value

**File:** `services/config.ts:140-142`
**Issue:** Previously identified in iteration 2's review and explicitly marked out of scope for this iteration ("Do NOT re-litigate the previously-accepted INFO finding (array-typed groups guard) -- it is knowingly out of scope"). Listed here only so the finding remains tracked in this final review's counts; not re-analyzed in this pass.
**Fix:** (unchanged from prior review) `if (parsed.groups == null || typeof parsed.groups !== "object" || Array.isArray(parsed.groups)) parsed.groups = {};`

---

_Reviewed: 2026-07-09T23:20:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
