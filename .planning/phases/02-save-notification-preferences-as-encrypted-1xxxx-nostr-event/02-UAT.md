---
status: testing
phase: 02-save-notification-preferences-as-encrypted-1xxxx-nostr-event
source: [02-VERIFICATION.md]
started: 2026-07-09T23:40:00Z
updated: 2026-07-09T23:40:00Z
---

## Current Test

number: 1
name: Live publish round trip — kind-30078 event reaches outbox relays on a rules change
expected: |
  With a live NIP-46 bunker connected, change a notification rule and wait >1.5s.
  A NIP-44-self-encrypted kind-30078 event with a stable d-tag (= PREFS_NAMESPACE) is
  signed and published to the user's outbox relays — visible via a relay REQ from a
  second client or the relay log (D2-02/D2-03/D2-07/D2-10).
awaiting: user response

## Tests

### 1. Live publish round trip
expected: With a live NIP-46 bunker connected, changing a notification rule and waiting >1.5s publishes a NIP-44-self-encrypted kind-30078 event (d-tag = PREFS_NAMESPACE) to the user's outbox relays, visible via a relay REQ from a second client or the relay log. (D2-02/D2-03/D2-07/D2-10)
result: pending

### 2. Live subscribe-and-apply round trip
expected: Publishing a newer kind-30078 event (same d-tag, same pubkey) from a second nostr client causes the running app to decrypt, validate, and update config$/config.json with the merged rules. (D2-08/D2-11)
result: pending

### 3. Loop-prevention over a live round trip
expected: After applying a remote update (test 2), no second / redundant kind-30078 event is republished back to relays — no echo loop occurs. (D2-09)
result: pending

### 4. Timeout-triggered degradation
expected: With a bunker connected then made unresponsive/offline, triggering a rules change causes the pipeline to log a timeout after ~8s while the app stays responsive; the local config.json save already succeeded and is never lost. (D2-14/D2-15)
result: pending

## Summary

total: 4
passed: 0
issues: 0
pending: 4
skipped: 0
blocked: 0

## Gaps
