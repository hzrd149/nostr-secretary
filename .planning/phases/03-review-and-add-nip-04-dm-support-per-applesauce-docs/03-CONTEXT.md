# Phase 3: Review and add NIP-04 DM support per applesauce docs - Context

**Gathered:** 2026-07-09
**Status:** Ready for planning
**Mode:** Smart discuss (autonomous) — grey areas proposed in batch, user accepted all three areas as recommended.

<domain>
## Phase Boundary

**Review and harden** the app's existing NIP-04 (legacy kind-4 `EncryptedDirectMessage`)
DM notification path so it correctly and robustly follows applesauce's documented
patterns. The flow already exists in `notifications/messages.ts` and already decrypts
via applesauce's `unlockLegacyMessage` — this phase closes the real gaps around it
rather than rebuilding.

Ships:
- **The actual bug fix:** add `nip04_decrypt` to `SIGNER_PERMISSIONS` (`const.ts:20-24`)
  so a fresh NIP-46 bunker connection is granted kind-4 decryption (kind-4 routes to
  `signer.nip04.decrypt`; a bunker only honors granted methods).
- **Robustness:** wrap the NIP-04 decrypt path in `catchError` (parity with the NIP-17
  path at `notifications/messages.ts:166-173`) so one undecryptable/rejected DM cannot
  kill the subscription; remove the unused `getLegacyMessageCorraspondant` import.
- **Existing-signer degradation:** a non-blocking "reconnect your signer" hint when NIP-04
  decryption fails for lack of permission (already-connected signers do not retroactively
  gain the new permission).
- **DM notification UX:** a click deep-link (via `appLink`) on DM notifications, consistent
  with other notification types; privacy-safe `sendContent` default preserved.
- **Tests:** `tests/notifications/messages.test.ts` (NIP-04 decrypt + `shouldNotify` gates,
  using a `PrivateKeySigner` fixture) and a `SIGNER_PERMISSIONS` case in `tests/const.test.ts`.

**Not in this phase:** NIP-17 gift-wrapped DMs (Phase 4 — leave the existing gift-wrap path
working, do not change it); the contacts/others DM split (Phase 5); rate limiting (Phases 6-7);
DM **sending** (no send surface exists — this is a receive-only notification secretary; the
roadmap goal's "sending" sub-clause has no current surface and is out of scope); the
cross-cutting `shouldNotify` dedup refactor (touches replies/zaps/groups — deferred tech debt).

</domain>

<decisions>
## Implementation Decisions

### Scope
- **D3-01 (review & harden, not rebuild):** The NIP-04 flow already exists and already uses
  applesauce's `unlockLegacyMessage(event, pubkey, signer)` (`notifications/messages.ts:123`).
  Deliverable is to fix the real gaps (permission, error handling, tests, deep-link), not to
  rebuild the pipeline.
- **D3-02 (add `nip04_decrypt` — REQUIRED):** Expand `SIGNER_PERMISSIONS` (`const.ts:20-24`)
  to also request `nip04_decrypt`. This is the concrete bug: kind-4 decryption delegates to
  `signer.nip04.decrypt`, and a NIP-46 bunker rejects methods it was not granted at connect
  time. Use the applesauce constant `Permission.Nip04Decrypt = "nip04_decrypt"`. Passed at
  connect in `services/signer.ts:116` (QR) and `:156` (bunker URI). Do NOT add `nip04_encrypt`
  — no send path (D3-03).
- **D3-03 (receive-only — no DM sending):** Do not build a NIP-04 send/reply flow. No sending
  surface exists anywhere in the app (grep confirmed only the kind-30078 prefs publish). The
  app is a notification secretary; "sending" from the roadmap goal is out of scope. Recorded as
  a deferred idea.

### Notification content & privacy
- **D3-04 (privacy-safe `sendContent`):** Keep `messages.sendContent` **off by default**, and
  ensure existing/migrated users are **off unless they explicitly opted in** — decrypted DM
  plaintext must not silently start flowing to the third-party ntfy server. `sendContent` stays
  a **local-only** toggle (deliberately excluded from the kind-30078 sync per phase-2
  `helpers/preferences.ts`). Planning should verify the config migration (`services/config.ts:110-119`)
  does not default upgraders to `sendContent: true`; if it does, flip it to require explicit opt-in.
- **D3-05 (generic title, gated body):** Keep the generic notification title
  ("<displayName> sent you a message"); include the decrypted message body **only** when
  `sendContent` is on, else the existing "[content omitted]" placeholder. No content snippet in
  the title.
- **D3-06 (deep-link):** Add a click deep-link to DM notifications via the `appLink` template
  (`helpers/link.ts`), so tapping opens the DM/conversation in the user's client — consistent
  with the click behavior other notification types already set. NIP-04 DM notifications
  currently set no `click`.

### Existing signers, robustness & tests
- **D3-07 (non-blocking reconnect hint):** Already-connected signers do not retroactively gain
  `nip04_decrypt`. When a NIP-04 decrypt fails due to a missing/denied permission, `log()` it and
  surface a **non-blocking** hint prompting the user to reconnect their signer to grant DM
  decryption. Mirror the phase-2 D2-14 feature-detect/notice pattern — degrade, do not throw or
  force a reconnect.
- **D3-08 (catchError parity — REQUIRED):** Wrap the NIP-04 `unlockLegacyMessage` path in
  `catchError(() => EMPTY)` (or equivalent inside the `mergeMap`) so a single decrypt
  rejection/undecryptable event does not tear down the messages subscription — parity with the
  NIP-17 path (`notifications/messages.ts:166-173`). Remove the unused
  `getLegacyMessageCorraspondant` import (`:4`).
- **D3-09 (tests):** Add `tests/notifications/messages.test.ts` covering NIP-04 decryption and
  the `shouldNotify` mute/whitelist/blacklist gates, using a `PrivateKeySigner` fixture (exposes
  `.nip04` directly, as in `tests/helpers/preferences.test.ts`). Add a `SIGNER_PERMISSIONS` case
  to `tests/const.test.ts` asserting `nip04_decrypt` is present. Never import the
  `notifications/index.ts` barrel in tests (side effects); import the specific module.
- **D3-10 (tight boundary):** Do not modify the NIP-17 gift-wrap path beyond leaving it working;
  do not implement the contacts/others split (Phase 5); do not perform the cross-cutting
  `shouldNotify` dedup refactor (deferred tech debt spanning replies/zaps/groups).

### Claude's Discretion
- Exact wording/placement of the reconnect hint (which page/card, log message text).
- Exact `catchError` placement and whether to add a lightweight per-event log on decrypt failure.
- Deep-link target encoding for a DM (npub of sender vs. an nevent of the message) — pick what
  the existing `appLink` placeholders and `helpers/link.ts` support most cleanly.
- Whether to add a small applesauce-pattern alignment tweak (e.g. using
  `getLegacyMessageParent`/correspondent helpers) if it improves correctness — as long as it
  stays within the NIP-04 review scope.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Roadmap / prior context
- `.planning/ROADMAP.md` §"Phase 3" — phase goal.
- `.planning/phases/02-.../02-CONTEXT.md` — D2-13 (SIGNER_PERMISSIONS expansion pattern),
  D2-14 (feature-detect + non-blocking notice degradation), and the local-only vs. synced
  preference split that `sendContent` follows.
- `.planning/codebase/` — ARCHITECTURE.md, CONCERNS.md (security: "Unencrypted DM content sent
  to a third-party ntfy server"; fragile `signer$` no-error-path), STRUCTURE.md ("Where to Add
  New Code"), CONVENTIONS.md.

### NIP references
- **NIP-04** (Encrypted Direct Message, kind 4) — the target. Deprecated in favor of NIP-17 but
  still widely used; this phase covers the legacy path.
- **NIP-46** (Nostr Connect / remote signing) — permission model; `nip04_decrypt` is the ONLY
  signer type wired (`NostrConnectAccount`).
- Read via `mcp__nostr__read_nip` and the **applesauce** skill / MCP docs
  (`mcp__applesauce__*`) for the documented legacy-message helpers
  (`unlockLegacyMessage`, `getLegacyMessageReceiver`, encrypted-content routing to `nip04`).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `notifications/messages.ts` — the NIP-04 (`:99-150`) and NIP-17 (`:152-205`) DM listeners;
  `shouldNotify` (`:41-69`), `enabled$` (`:72-85`), `enabledSigner` (`:87-97`). NIP-04 kind
  filter `kinds.EncryptedDirectMessage` (`:105`), receiver via `getLegacyMessageReceiver` (`:110`),
  decrypt via `unlockLegacyMessage` (`:123`), ntfy send (`:145-149`). **No `catchError` on the
  NIP-04 path** (D3-08). Unused import at `:4` (D3-08).
- `const.ts:20-24` — `SIGNER_PERMISSIONS` (**must expand** — D3-02); already includes
  `sign_event:22242`, `sign_event:30078`, `nip44_encrypt`, `nip44_decrypt`.
- `services/signer.ts` — `signer$` (`:21`), permission passing at connect (`:116` QR, `:156`
  bunker URI); NIP-46 remote signer only.
- `services/nostr.ts` — `tagged$` (`:193-214`, carries kind-4 DMs via `#p`=user), one EventStore
  (`:63`), `eventStore.profile(...)`. `giftWraps$` (`:217-240`) is NIP-17 (leave alone — D3-10).
- `services/ntfy.ts` — `sendNotification` (`:129`), `NtfyNotificationOptions` (`:43-74`,
  `click`/`icon`/`title` fields for the deep-link — D3-06).
- `helpers/link.ts` — `appLink` template substitution for the DM deep-link (D3-06).
- `services/config.ts` — `AppConfig.messages` (`:27-33`: `{enabled, sendContent, whitelists,
  blacklists}`), defaults (`:64-69`), legacy migration (`:110-119` — verify `sendContent` default,
  D3-04).

### Established Patterns
- Notification listeners self-subscribe on import, gate via `enabled$` (config slice) +
  `shouldNotify`, call `sendNotification`. `catchError(() => EMPTY)` inside `mergeMap` keeps
  subscriptions alive (NIP-17 path is the template — D3-08). Localized `try/catch` + `log()`,
  never `console.log`.
- Signer permission expansion mirrors phase-2 D2-13; degradation/notice mirrors D2-14 (D3-07).

### Integration Points
- `const.ts` — permission expansion (D3-02).
- `notifications/messages.ts` — catchError + deep-link + dead-import cleanup (D3-06/08).
- `services/signer.ts` and/or a `/status`/`/messages` card — the reconnect hint (D3-07).
- `services/config.ts` — migration default check (D3-04).
- Tests: `tests/notifications/messages.test.ts` (new) + `tests/const.test.ts` (D3-09). Fixture
  `PrivateKeySigner` per `tests/helpers/preferences.test.ts`. `tests/setup.ts` isolates `CONFIG`.

</code_context>

<specifics>
## Specific Ideas

- The one true bug is the missing `nip04_decrypt` permission — everything else is hardening.
- Preserve read-only/no-signer behavior: users with no signer keep working; DM decryption simply
  no-ops (already gated by `enabledSigner`).
- Keep decrypted DM plaintext off the ntfy channel unless the user explicitly opted in
  (`sendContent`), matching the CONCERNS.md security note.

</specifics>

<deferred>
## Deferred Ideas

- **NIP-04 DM sending/reply** — no send surface exists; out of scope for a notification
  secretary (D3-03). Revisit only if the app grows a compose feature.
- **NIP-17 gift-wrap review/hardening** — explicitly Phase 4.
- **Contacts vs. others DM split** — explicitly Phase 5.
- **Cross-cutting `shouldNotify` dedup factory** (replies/zaps/messages/groups) — deferred tech
  debt (CONCERNS.md); too broad and risky to fold into this focused DM phase.
- **`giftWraps$` `skip(1)` fragility fix** — a NIP-17 concern; address with Phase 4.

</deferred>

---

*Phase: 03-review-and-add-nip-04-dm-support-per-applesauce-docs*
*Context gathered: 2026-07-09 (smart discuss, autonomous mode)*
