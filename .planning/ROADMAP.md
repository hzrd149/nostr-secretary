# Roadmap

## Phases

### Phase 1: NIP-29 group notification modes

**Goal:** Add per-group notification mode settings (all messages, only @mention, etc.) for NIP-29 groups, including a NIP-29 groups section in the notifications settings view.
**Depends on:** None
**Requirements:** D-01, D-02, D-03, D-04, D-05, D-06, D-07, D-08, D-09, D-10 (decisions in 01-CONTEXT.md — no formal REQUIREMENTS.md for this project)
**Plans:** 5/5 plans complete

Plans:
**Wave 1**

- [x] 01-01-PLAN.md — Pure group-mode helpers + test infra (Wave 1)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 01-02-PLAN.md — Config storage, migration backfill, D-07 changelog (Wave 2)

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 01-03-PLAN.md — Notification mode gate wiring + D-09 truth table (Wave 3)
- [x] 01-04-PLAN.md — /groups per-group list + PATCH with ASVS V5 validation (Wave 3)
- [x] 01-05-PLAN.md — /notifications Groups card summary (Wave 3)

### Phase 2: Save notification preferences as encrypted 1xxxx nostr event

**Goal:** Persist user notification preferences (per NIP-29 group and for public nostr in general) as an encrypted NIP-78 kind-30078 replaceable Nostr event (D2-01 supersedes the literal "1xxxx" wording) so settings survive restarts, sync across devices/clients over nostr, allow other simple web apps to modify them, and let the notification server subscribe for updates.
**Depends on:** Phase 1
**Requirements:** D2-01, D2-02, D2-03, D2-04, D2-05, D2-06, D2-07, D2-08, D2-09, D2-10, D2-11, D2-12, D2-13, D2-14, D2-15 (decisions in 02-CONTEXT.md — no formal REQUIREMENTS.md for this project)
**Plans:** 4/4 plans complete

Plans:
**Wave 1**

- [x] 02-01-PLAN.md — Pure preferences helpers (serialize/merge/validate/conflict) + tests (Wave 1)
- [x] 02-02-PLAN.md — Expand + wire SIGNER_PERMISSIONS for kind-30078 signing & NIP-44 (Wave 1)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 02-03-PLAN.md — Reactive preferences service: publish-on-change + subscribe-and-apply (Wave 2)

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 02-04-PLAN.md — Non-blocking no-signer sync hint on /notifications (Wave 3)

### Phase 3: Review and add NIP-04 DM support per applesauce docs

**Goal:** Review current DM handling and add proper NIP-04 DM support, following the recommended implementation approach from the applesauce SDK documentation. Ensure decryption, sending, and subscription flows match applesauce's documented patterns for NIP-04 encrypted direct messages.
**Depends on:** None
**Requirements:** D3-01, D3-02, D3-03, D3-04, D3-05, D3-06, D3-07, D3-08, D3-09, D3-10 (decisions in 03-CONTEXT.md — no formal REQUIREMENTS.md for this project; DM *sending* from the goal is out of scope per D3-03, receive-only app)
**Plans:** 3/3 plans complete

Plans:
**Wave 1**

- [x] 03-01-PLAN.md — Add nip04_decrypt to SIGNER_PERMISSIONS + tests (the one true bug, D3-02/D3-03)
- [x] 03-02-PLAN.md — Privacy-safe sendContent migration default + extract migrateConfig + tests (D3-04)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 03-03-PLAN.md — NIP-04 listener hardening: catchError parity, reconnect hint, deep-link, dead-import cleanup + tests (D3-05..D3-10)

### Phase 4: Add NIP-17 DM notifications support per applesauce docs

**Goal:** Add support for NIP-17 (Gift-wrapped Direct Messages) DM notifications, following the recommended implementation approach from the applesauce SDK documentation. Ensure the notification server subscribes to NIP-17 wrapped DM events, decrypts them via applesauce's documented patterns, and fires notifications for new DMs.
**Depends on:** Phase 3
**Requirements:** D4-01, D4-02, D4-03, D4-04, D4-05, D4-06, D4-07, D4-08, D4-09 (decisions in 04-CONTEXT.md — no formal REQUIREMENTS.md for this project; review/harden phase)
**Plans:** 2/2 plans complete

Plans:
**Wave 1**

- [x] 04-01-PLAN.md — Pure NIP-17 units + tests: notifyNewGiftWraps dedup combinator (D4-02) + unlockPrivateDirectMessage unwrap/classify (D4-01/D4-09) (Wave 1)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 04-02-PLAN.md — Wire the units in: giftWraps$ seed+live rewrite (D4-02) + NIP-17 block hardening — extracted-unit rewire, safe error-guard, deep-link, guarded profile lookup (D4-04/D4-06/D4-09) (Wave 2)

### Phase 5: DM notifications split into contacts and others categories

**Goal:** Split DM notifications into two default categories: "contacts" (DMs from users the recipient follows) and "others" (DMs from users not in the recipient's contact list). Each category gets its own default notification settings, so users can easily manage notifications for friends vs. strangers messaging them. This avoids a single blanket DM notification setting and gives users granular control over who can ping them.
**Depends on:** Phase 3, Phase 4
**Requirements:** D5-01, D5-02, D5-03, D5-04, D5-05, D5-06, D5-07, D5-08, D5-09, D5-10 (CONTEXT.md decisions serve as the requirements contract)
**Plans:** 3/3 plans complete

Plans:
**Wave 1**

- [x] 05-01-PLAN.md — Reactive no-signer contacts$/isContact + pure classifyDmSender unit (Wave 1)
- [x] 05-02-PLAN.md — messages config schema cutover: per-category enable + migration + defaults + kind-30078 sync + two-section /messages UI (Wave 1)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 05-03-PLAN.md — Layered per-category enable gate in both NIP-04/NIP-17 DM listeners + truth-table test (Wave 2)

### Phase 6: Notification rate limiting per type and global with grouped overflow

**Goal:** Introduce rate limiting for notifications — both per-notification-type limits and a global rate limit across all notifications — to prevent spamming the user's phone when there's heavy group chat activity or repeated nostr tags. When notifications hit a rate limit, send a single grouped notification letting the user know a lot of stuff has happened (e.g., "47 new mentions, 12 group messages") instead of delivering each one individually.
**Depends on:** None
**Requirements:** D6-01, D6-02, D6-03, D6-04, D6-05, D6-06, D6-07, D6-08, D6-09, D6-10
**Plans:** 4 plans

Plans:
**Wave 1**

- [ ] 06-01-PLAN.md — Pure clock-injectable rate-limit accounting/summary unit + full test matrix (D6-02/04/05/09/10)
- [ ] 06-02-PLAN.md — AppConfig.rateLimit + migration/defaults + kind-30078 sync + CHANGELOG (D6-07/09)

**Wave 2** *(blocked on Wave 1 completion)*

- [ ] 06-03-PLAN.md — services/rate-limit.ts choke point + config-driven flush bypass + 5 call-site swaps (D6-01/03/06/10)
- [ ] 06-04-PLAN.md — Minimal per-type + global/window rate-limit UI incl. notifications.tsx first PATCH route (D6-08)

### Phase 7: Default rate limit for chat groups and DMs on join

**Goal:** Set a sensible default notification rate limit for NIP-29 groups, DMs, and other chat-type contexts where messages are likely to arrive in quick succession. When a user joins a new group or a new DM conversation is created, the default rate limit should be applied automatically so the user is not spammed during initial activity bursts.
**Depends on:** Phase 6, Phase 3
**Requirements:** TBD
**Plans:** 0 plans

Plans:

- [ ] TBD (plan with /gsd-plan-phase)

## Backlog

### Phase 999.3: Reimagine web config pages from scratch (BACKLOG)

**Goal:** Throw away the existing web config pages and rebuild them from scratch with better layouts and simpler flows. The current pages are being completely reimagined rather than iteratively improved.
**Requirements:** TBD
**Plans:** 0 plans

Plans:

- [ ] TBD (promote with /gsd-review-backlog when ready)

### Phase 999.4: Web config guided setup flow (BACKLOG)

**Goal:** Add a guided setup flow to the web config pages that walks the user through (1) connecting their signer or opting for read-only mode, (2) setting notification preferences, and (3) connecting their ntfy app. Related to 999.3 (web config reimagining) — this is the onboarding/setup flow slice of that larger effort.
**Requirements:** TBD
**Plans:** 0 plans

Plans:

- [ ] TBD (promote with /gsd-review-backlog when ready)
