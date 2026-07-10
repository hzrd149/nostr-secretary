---
status: testing
phase: 03-review-and-add-nip-04-dm-support-per-applesauce-docs
source: [03-VERIFICATION.md]
started: 2026-07-10T05:00:00Z
updated: 2026-07-10T05:00:00Z
---

## Current Test

number: 1
name: Fresh NIP-46 bunker connect + real kind-4 NIP-04 DM decrypt
expected: |
  The bunker honors the newly-requested nip04_decrypt permission at connect
  time; the legacy kind-4 DM decrypts and a notification is delivered with the
  correct generic title, gated body (only when messages.sendContent is on), and
  a working click deep-link.
awaiting: user response

## Tests

### 1. Fresh bunker connect + real kind-4 DM decrypt
expected: Connect a fresh NIP-46 bunker session and send yourself (or have another account send) a legacy kind-4 NIP-04 DM. Confirm a notification fires with decrypted content when messages.sendContent is on. The bunker must grant the newly-requested nip04_decrypt permission at connect time.
result: [pending]

### 2. Reconnect hint appears/clears for an already-connected signer
expected: Using a pre-existing signer session that lacks the nip04_decrypt permission, trigger a NIP-04 DM decrypt attempt. Confirm the non-blocking reconnect hint (DmDecryptHint) appears on /notifications, then clears after reconnecting the signer with the new permission (nip04DecryptDegraded$ flips true on the failed decrypt and back to false on the next successful decrypt).
result: [pending]

## Summary

total: 2
passed: 0
issues: 0
pending: 2
skipped: 0
blocked: 0

## Gaps
