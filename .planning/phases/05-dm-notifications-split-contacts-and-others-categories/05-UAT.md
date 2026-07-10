---
status: testing
phase: 05-dm-notifications-split-contacts-and-others-categories
source: [05-VERIFICATION.md]
started: 2026-07-10T00:00:00Z
updated: 2026-07-10T00:00:00Z
---

## Current Test

number: 1
name: Live categorization + per-category gating across both DM transports
expected: |
  With a live signer + a real kind-3 follow list: a DM from a FOLLOWED user is
  categorized "contacts" and notifies (contacts enabled); a DM from a
  NOT-followed user is categorized "others" and is suppressed when others is
  disabled. Holds for BOTH NIP-04 and NIP-17 DMs. The existing
  mute/whitelist/blacklist still applies on top (category gate does not bypass it).
awaiting: user response

## Tests

### 1. Live categorization + per-category gating (both DM types)
expected: Connect a signer with a kind-3 follow list. Receive a DM from a followed sender (→ contacts, notifies) and a non-followed sender (→ others, suppressed when others disabled), over both NIP-04 and NIP-17. Confirm mute/whitelist/blacklist still applies.
result: [pending]

### 2. Reactive re-classification on follow/unfollow
expected: Follow a previously-unfollowed sender (or unfollow a followed one); confirm subsequent DMs from them re-classify to the new category without a restart (contacts$ is reactive).
result: [pending]

### 3. /messages two-section UI save/reload round-trip
expected: Open /messages; the page shows two sections (Contacts / Others) each with an enable toggle plus the shared sendContent + whitelist/blacklist. Toggle each, save, reload; confirm both category settings persist.
result: [pending]

### 4. Multi-device kind-30078 sync (incl. old-schema peer)
expected: With sync active, change a category toggle on one device and confirm it propagates to another. Also confirm a pre-Phase-5 (old-schema) peer's payload does NOT silently disable both categories (old enabled:true → both true; enabled:false → both false).
result: [pending]

## Summary

total: 4
passed: 0
issues: 0
pending: 4
skipped: 0
blocked: 0

## Gaps
