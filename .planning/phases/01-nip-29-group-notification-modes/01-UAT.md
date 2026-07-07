---
status: testing
phase: 01-nip-29-group-notification-modes
source: [01-VERIFICATION.md]
started: 2026-07-07T23:20:00Z
updated: 2026-07-07T23:20:00Z
---

## Current Test

number: 1
name: /groups renders one row per joined NIP-29 group with a preset mode control
expected: |
  Each joined group appears as a correctly laid-out row with avatar (or 👥 placeholder),
  name (or "Unnamed group"), a mode badge, and a mode dropdown preset to the group's
  current effective mode. A user with zero groups sees the empty-state message instead.
awaiting: user response

## Tests

### 1. /groups per-group row rendering (D-03/D-04)
expected: On /groups, with a signer that has joined ≥1 real NIP-29 group, each joined group renders a row with avatar (or 👥 placeholder), name (or "Unnamed group"), a mode badge, and a mode dropdown preset to the group's current effective mode. A user with zero groups sees the empty-state message.
result: [pending]

### 2. /groups mode save → reload persistence round trip (D-10)
expected: On /groups, changing a group's mode dropdown and clicking "Save Group Settings", then reloading /groups, shows the dropdown retaining the saved value; config.json's groups.modes has exactly the expected encodeGroupPointer key/value with no unexpected keys.
result: [pending]

## Summary

total: 2
passed: 0
issues: 0
pending: 2
skipped: 0
blocked: 0

## Gaps
