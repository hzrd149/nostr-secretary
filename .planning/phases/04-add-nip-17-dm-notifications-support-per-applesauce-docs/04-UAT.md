---
status: testing
phase: 04-add-nip-17-dm-notifications-support-per-applesauce-docs
source: [04-VERIFICATION.md]
started: 2026-07-10T00:00:00Z
updated: 2026-07-10T00:00:00Z
---

## Current Test

number: 1
name: Live NIP-17 gift-wrapped DM end-to-end (decrypt once, no re-notify on restart, self-heal)
expected: |
  With a live NIP-46 signer and real DM relays: a gift-wrapped (NIP-17) DM
  decrypts and fires exactly one notification (with a working deep-link, and
  gated body per messages.sendContent). On restart, the same historical DM is
  NOT re-notified. A genuinely-new DM arriving after startup IS notified. If a
  DM relay is briefly unreachable at startup, notifications are suppressed (not
  mass re-fired) and resume automatically once the relay recovers.
awaiting: user response

## Tests

### 1. Live gift-wrapped DM end-to-end + dedup + self-heal
expected: Connect a live NIP-46 signer with configured DM relays (kind 10050). Receive/send yourself a NIP-17 gift-wrapped DM; confirm exactly one notification fires (deep-link works; body shown only if messages.sendContent is on). Restart the process; confirm the same historical DM is NOT re-notified. Send a new DM after restart; confirm it IS notified. Optionally: start with a slow/unreachable DM relay; confirm no mass re-notification and that notifications resume after the relay recovers.
result: [pending]

## Summary

total: 1
passed: 0
issues: 0
pending: 1
skipped: 0
blocked: 0

## Gaps
