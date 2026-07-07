# Roadmap

## Backlog

### Phase 999.1: NIP-29 group notification modes (BACKLOG)

**Goal:** Add per-group notification mode settings (all messages, only @mention, etc.) for NIP-29 groups, including a NIP-29 groups section in the notifications settings view.
**Requirements:** TBD
**Plans:** 0 plans

Plans:
- [ ] TBD (promote with /gsd-review-backlog when ready)

### Phase 999.2: Save notification preferences as encrypted 1xxxx nostr event (BACKLOG)

**Goal:** Persist user notification preferences (per NIP-29 group and for public nostr in general) as an encrypted 1xxxx replaceable Nostr event so settings survive restarts, sync across devices/clients over nostr, allow other simple web apps to modify them, and let the notification server subscribe for updates.
**Requirements:** TBD
**Plans:** 0 plans

Plans:
- [ ] TBD (promote with /gsd-review-backlog when ready)

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

### Phase 999.5: Notification rate limiting per type and global with grouped overflow (BACKLOG)

**Goal:** Introduce rate limiting for notifications — both per-notification-type limits and a global rate limit across all notifications — to prevent spamming the user's phone when there's heavy group chat activity or repeated nostr tags. When notifications hit a rate limit, send a single grouped notification letting the user know a lot of stuff has happened (e.g., "47 new mentions, 12 group messages") instead of delivering each one individually.
**Requirements:** TBD
**Plans:** 0 plans

Plans:
- [ ] TBD (promote with /gsd-review-backlog when ready)

### Phase 999.6: Default rate limit for chat groups and DMs on join (BACKLOG)

**Goal:** Set a sensible default notification rate limit for NIP-29 groups, DMs, and other chat-type contexts where messages are likely to arrive in quick succession. When a user joins a new group or a new DM conversation is created, the default rate limit should be applied automatically so the user is not spammed during initial activity bursts. Related to 999.5 (notification rate limiting) — this is the default-applied-to-chat-contexts slice of that larger effort.
**Requirements:** TBD
**Plans:** 0 plans

Plans:
- [ ] TBD (promote with /gsd-review-backlog when ready)

### Phase 999.7: Review and add NIP-04 DM support per applesauce docs (BACKLOG)

**Goal:** Review current DM handling and add proper NIP-04 DM support, following the recommended implementation approach from the applesauce SDK documentation. Ensure decryption, sending, and subscription flows match applesauce's documented patterns for NIP-04 encrypted direct messages.
**Requirements:** TBD
**Plans:** 0 plans

Plans:
- [ ] TBD (promote with /gsd-review-backlog when ready)

### Phase 999.8: Add NIP-17 DM notifications support per applesauce docs (BACKLOG)

**Goal:** Add support for NIP-17 (Gift-wrapped Direct Messages) DM notifications, following the recommended implementation approach from the applesauce SDK documentation. Ensure the notification server subscribes to NIP-17 wrapped DM events, decrypts them via applesauce's documented patterns, and fires notifications for new DMs. Related to 999.7 (NIP-04 DM support) — these are the two DM NIPs that should both be supported.
**Requirements:** TBD
**Plans:** 0 plans

Plans:
- [ ] TBD (promote with /gsd-review-backlog when ready)

### Phase 999.9: DM notifications split into contacts and others categories (BACKLOG)

**Goal:** Split DM notifications into two default categories: "contacts" (DMs from users the recipient follows) and "others" (DMs from users not in the recipient's contact list). Each category gets its own default notification settings, so users can easily manage notifications for friends vs. strangers messaging them. This avoids a single blanket DM notification setting and gives users granular control over who can ping them. Related to 999.7/999.8 (DM support) and 999.1 (notification modes) — this is the DM-specific categorization slice.
**Requirements:** TBD
**Plans:** 0 plans

Plans:
- [ ] TBD (promote with /gsd-review-backlog when ready)
