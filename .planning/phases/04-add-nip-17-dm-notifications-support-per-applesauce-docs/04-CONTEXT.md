# Phase 4: Add NIP-17 DM notifications support per applesauce docs - Context

**Gathered:** 2026-07-10
**Status:** Ready for planning
**Mode:** Smart discuss (autonomous) — grey areas proposed in batch, user accepted all three areas as recommended.

<domain>
## Phase Boundary

**Review and harden** the app's existing NIP-17 (gift-wrapped, kind-1059 → inner kind-14
`PrivateDirectMessage`) DM notification path so it correctly and robustly follows applesauce's
documented patterns, and fix the one known correctness bug in the gift-wrap subscription. The
listener already exists in `notifications/messages.ts` (the NIP-17 block) and already decrypts
via applesauce's `unlockGiftWrap` — this phase closes the gaps around it rather than rebuilding.

Ships:
- **The core correctness fix (D4-02):** replace the fragile `limit: 1` + `skip(1)` "only new
  ones" hack in `giftWraps$` (`services/nostr.ts:217-240`) with seen-event-id dedup / high-water
  logic. Gift-wrap `created_at` is deliberately randomized (up to ~2 days in the past, per NIP-17,
  to obscure timing), so `since:`-based filtering is unreliable AND `skip(1)` drops a genuinely new
  DM whenever a relay returns 0 historical events on first sync (or behaves undefined on >1). Notify
  only on genuinely-new gift wraps.
- **NIP-04 consistency:** add a click deep-link (`buildOpenLink(event)`) to NIP-17 DM
  notifications, matching Phase 3; apply the safe `instanceof Error` error-extraction guard to the
  NIP-17 `catchError` (the improvement deferred from Phase 3's D3-10 boundary).
- **Tests:** network-safe NIP-17 tests (gift-wrap unwrap + `shouldNotify` gate + the new
  dedup/high-water logic), extracting testable units the way Phase 3 extracted `legacy-messages.ts`.

**Not in this phase:** NIP-04 legacy DMs (Phase 3 — do not touch that path); the contacts/others
DM split (Phase 5); rate limiting (Phases 6-7); a reconnect/permission hint for NIP-17 (D4-05 —
gift-wrap decrypt failures are common/expected and must not be treated as a permission problem).

</domain>

<decisions>
## Implementation Decisions

### Scope & correctness
- **D4-01 (review & harden, not rebuild):** The NIP-17 flow already exists and already uses
  applesauce's `unlockGiftWrap(event, signer)` and filters `rumor.kind === PrivateDirectMessage`.
  Deliverable is to fix the real gaps (the `skip(1)` fragility, deep-link, error-guard, tests),
  not to rebuild the pipeline.
- **D4-02 (fix `skip(1)`/`limit:1` fragility — REQUIRED):** Replace the `limit: 1` + `skip(1)`
  approach in `giftWraps$` (`services/nostr.ts:217-240`) with seen-event-id dedup / high-water-mark
  logic so genuinely-new gift wraps are never dropped and startup historical wraps are not
  re-notified. Because gift-wrap `created_at` is randomized, do NOT rely on `since:`; instead track
  processed event IDs (or the set of ids present in the store at startup) and notify only on ids not
  seen before. Follow applesauce's documented NIP-17 subscription pattern — the researcher must
  confirm the recommended approach (e.g. an initial "seed the store without notifying" pass, then
  notify on new inserts). Keep the `#p: [user]`, `kinds: [GiftWrap]`, `messageInboxes$` (DM-relay)
  subscription and `{ reconnect: Infinity }`.
- **D4-03 (no permission change):** NIP-17 gift-wrap unwrap uses NIP-44 decryption; `nip44_decrypt`
  is already in `SIGNER_PERMISSIONS` (added in Phase 2, D2-13). No `const.ts` permission change is
  needed. Do NOT add any NIP-04 permission here (that was Phase 3).

### Consistency with the NIP-04 phase (Phase 3)
- **D4-04 (deep-link):** Add a click deep-link to NIP-17 DM notifications via
  `buildOpenLink(event)`, consistent with Phase 3's NIP-04 deep-link (D3-06) and
  `replies.ts`/`zaps.ts`. Thread the raw gift-wrap (or an appropriate pointer) through to the
  notification's `click`.
- **D4-05 (NO reconnect hint for NIP-17 — deliberate):** Do NOT drive the `nip04DecryptDegraded$`
  reconnect hint (or a NIP-17 analogue) on gift-wrap decrypt failures. Unlike a NIP-04 decrypt
  failure while connected (which strongly implies a missing `nip04_decrypt` permission — Phase 3
  D3-07), a failed **gift-wrap** unwrap is common and expected: anyone can send the user a gift wrap,
  and spam/malformed/not-for-this-key wraps routinely fail to decrypt. Surfacing a "reconnect your
  signer" hint on those would be a noisy false positive. Keep the existing `catchError(() => EMPTY)`
  + `log()` per-message isolation; do not add a degraded signal for NIP-17.
- **D4-06 (safe error-guard):** Apply the safe error-extraction guard
  (`error instanceof Error ? error.message : String(error)`) to the NIP-17 gift-wrap `catchError`'s
  `log(...)` call. This is the exact one-line improvement that was symmetrically applied then
  reverted at the end of Phase 3 to honor the D3-10 boundary — it now legitimately belongs to this
  phase. It prevents a `TypeError` when a rejection reason is a non-`Error` primitive.

### Content, boundary & tests
- **D4-07 (generic title, gated body):** Keep the generic notification title and include the
  decrypted message body **only** when `messages.sendContent` is on (the existing gate). No content
  in the title. NIP-17 already respects `sendContent` — do not regress the privacy gate.
- **D4-08 (tight boundary):** NIP-17 only. Do NOT modify the NIP-04 legacy path (Phase 3, done);
  do NOT implement the contacts/others split (Phase 5); do NOT add rate limiting (Phases 6-7); do
  NOT do a cross-cutting `shouldNotify` dedup refactor.
- **D4-09 (tests):** Add network-safe NIP-17 tests covering gift-wrap unwrap, the
  `rumor.kind === PrivateDirectMessage` filter, the `shouldNotify` gates, and — most importantly —
  the new dedup/high-water logic (a historical wrap present at startup is NOT notified; a new wrap
  arriving after startup IS). Extract the testable decision logic into a pure, injectable unit
  (mirroring Phase 3's `notifications/legacy-messages.ts`) so tests don't import the self-subscribing
  `notifications/messages.ts` or `services/nostr.ts` (network-via-loader). Use a `PrivateKeySigner`
  fixture (exposes `.nip44`).

### Claude's Discretion
- The exact dedup mechanism (a `Set<string>` of processed ids vs. a store-seeded high-water) — let
  research/planning pick what applesauce documents and what fits the RxJS singleton pattern.
- Where the extracted pure unit lives (`notifications/gift-wrap-messages.ts` vs. adding to
  `legacy-messages.ts`) — follow the Phase 3 precedent.
- Deep-link pointer encoding for a gift-wrapped DM (sender npub vs. an event pointer) — use what
  `helpers/link.ts` / `buildOpenLink` supports cleanly for the unwrapped rumor's author.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Roadmap / prior context
- `.planning/ROADMAP.md` §"Phase 4" — phase goal.
- `.planning/phases/03-.../03-CONTEXT.md` and `03-RESEARCH.md` — the NIP-04 review/harden this
  phase mirrors (deep-link D3-06, catchError parity D3-08, the extracted `legacy-messages.ts` test
  pattern D3-09, and the D3-10 boundary that deferred the NIP-17 error-guard here).
- `.planning/phases/02-.../02-CONTEXT.md` — D2-13 (`nip44_decrypt` already granted).
- `.planning/codebase/CONCERNS.md` — "`giftWraps$` uses `skip(1)` assuming exactly one historical
  event" (the D4-02 bug) and "`mailboxes$`/`messageInboxes$` silently complete after 10s timeout".

### NIP references
- **NIP-17** (Private Direct Messages) + **NIP-59** (Gift Wrap, kind 1059) — the target; randomized
  `created_at`, inner kind-14 `PrivateDirectMessage` rumor.
- **NIP-44** (Encrypted Payloads v2) — gift-wrap encryption; `nip44_decrypt` permission.
- Read via `mcp__nostr__read_nip` and the **applesauce** skill / MCP docs (`mcp__applesauce__*`)
  for the documented gift-wrap helpers (`unlockGiftWrap`, `GiftWrap`/`PrivateDirectMessage` kinds,
  the recommended subscribe-and-dedup pattern for randomized-timestamp gift wraps).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `services/nostr.ts:217-240` — `giftWraps$` (**the D4-02 fix target**): `combineLatest([user$,
  messageInboxes$])` → `pool.subscription(messageInboxes, { "#p":[user], kinds:[GiftWrap], limit:1 },
  { reconnect: Infinity })` → `skip(1)` → `mapEventsToStore` → `share()`. `messageInboxes$`
  (`:96-...`, kind 10050 `DirectMessageRelaysList`) is the DM-relay source.
- `notifications/messages.ts` — the NIP-17 gift-wrap listener (subscribes off `giftWraps$`,
  `unlockGiftWrap(event, signer)`, filters `rumor.kind === PrivateDirectMessage`, `shouldNotify`,
  `sendNotification`; its `catchError` log is the D4-06 target). The NIP-04 block + the extracted
  `notifications/legacy-messages.ts` (`decryptLegacyDirectMessage`, `getMessageDisplayName`) are the
  Phase-3 analogs for the deep-link, error-guard, and extract-pure-unit test approach.
- `helpers/link.ts` `buildOpenLink(event)` — the deep-link (D4-04); `replies.ts:106`/`zaps.ts:111`
  are the `click: buildOpenLink(event)` precedent.
- `services/ntfy.ts` `sendNotification` / `NtfyNotificationOptions` (`click`/`icon`/`title`).
- `services/config.ts` `AppConfig.messages` `{enabled, sendContent, whitelists, blacklists}` — the
  `sendContent` gate (D4-07); NIP-17 shares the `messages` config slice with NIP-04.

### Established Patterns
- RxJS singletons self-subscribe on import; `catchError(() => EMPTY)` inside the per-event pipeline
  keeps the subscription alive; `log()` never `console.log`. Gift-wrap timestamps are randomized —
  the seen-id/high-water dedup (D4-02) is the RxJS-idiomatic replacement for `skip(1)`.
- Network-safe tests import specific pure modules, never the `notifications/index.ts` barrel or the
  self-subscribing `services/nostr.ts` (its `eventStore` loader hits the network). `PrivateKeySigner`
  is the decrypt fixture. `bunfig.toml`/`tests/setup.ts` isolate `CONFIG`.

### Integration Points
- `services/nostr.ts` — `giftWraps$` dedup/high-water rewrite (D4-02).
- `notifications/messages.ts` — NIP-17 block: deep-link (D4-04), error-guard (D4-06), and call into
  the extracted pure unit (D4-09).
- New pure module (e.g. `notifications/gift-wrap-messages.ts`) + tests
  (`tests/notifications/*.test.ts`), plus a `giftWraps$`/dedup unit test.

</code_context>

<specifics>
## Specific Ideas

- The one true correctness bug is the `skip(1)`/`limit:1` gift-wrap subscription — genuinely-new
  DMs can be dropped. Everything else is consistency/hardening.
- NIP-17 decrypt failures are NORMAL (spam wraps) — never treat them as a signer-permission problem
  (contrast with NIP-04's D3-07 hint).
- Preserve the `sendContent` privacy gate and no-signer degradation exactly as today.

</specifics>

<deferred>
## Deferred Ideas
- **NIP-17 DM sending / replies** — receive-only notification secretary; no send surface (mirrors
  D3-03). Out of scope.
- **Contacts vs. others DM split** — explicitly Phase 5 (applies to both NIP-04 and NIP-17).
- **Rate limiting / grouped overflow for DM bursts** — Phases 6-7.
- **A NIP-17 decrypt-degraded reconnect hint** — deliberately excluded (D4-05); would be a noisy
  false positive on ordinary spam-wrap decrypt failures.
- **`messageInboxes$` 10s-timeout silent-complete fragility** (CONCERNS.md) — a broader relay-loader
  resilience issue, not scoped here unless it directly blocks D4-02.
</deferred>

---

*Phase: 04-add-nip-17-dm-notifications-support-per-applesauce-docs*
*Context gathered: 2026-07-10 (smart discuss, autonomous mode)*
