---
status: testing
phase: 07-default-rate-limit-for-chat-groups-and-dms-on-join
source: [07-VERIFICATION.md]
started: 2026-07-13T22:06:30Z
updated: 2026-07-13T22:06:30Z
---

## Current Test

number: 1
name: New rate-limit fields render, save, and persist on /groups and /messages
expected: |
  Both the "Default Per-Group Rate Limit" (perGroup, default 3) field on /groups and the
  "Default Per-DM Rate Limit" (perDm, default 5) field on /messages render below their existing
  per-type field, save via the PATCH form, and survive a page reload without disturbing the
  existing per-type field's value.
awaiting: user response

## Tests

### 1. New rate-limit fields render, save, and persist on /groups and /messages
expected: Open /groups — the new "Default Per-Group Rate Limit" field renders with the current perGroup value (3 by default) below the existing per-type field; change it and save via the PATCH form; reload and confirm it persisted. Repeat for /messages' "Default Per-DM Rate Limit" field (perDm, default 5). Neither save disturbs the existing per-type field's value. Help text on both reads "0 = unlimited".
result: [pending]

### 2. Kind-30078 encrypted sync round trip for perGroup/perDm across devices
expected: With a real Nostr signer configured, change perGroup/perDm on one device/session and confirm the encrypted kind-30078 preference event carries the new values and a second session picks them up. Also confirm a pre-Phase-7 peer's payload without these keys falls back to local defaults (never 0) in a live sync — old-format payloads never silently disable per-context throttling.
result: [pending]

## Summary

total: 2
passed: 0
issues: 0
pending: 2
skipped: 0
blocked: 0

## Gaps
