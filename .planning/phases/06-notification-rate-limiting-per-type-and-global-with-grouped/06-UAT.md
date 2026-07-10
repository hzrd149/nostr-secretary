---
status: testing
phase: 06-notification-rate-limiting-per-type-and-global-with-grouped
source: [06-VERIFICATION.md]
started: 2026-07-10T00:00:00Z
updated: 2026-07-10T00:00:00Z
---

## Current Test

number: 1
name: Live burst → single grouped overflow summary
expected: |
  With a live signer + real relay traffic exceeding the configured per-type or
  global limit within a window: per-item notifications stop at the limit, and
  exactly ONE combined grouped-overflow summary (counts only, e.g. "47 new
  mentions, 12 group messages") arrives at window end — never DM plaintext.
awaiting: user response

## Tests

### 1. Live burst → single grouped overflow summary
expected: Generate a burst of qualifying events (mentions/group messages/etc.) exceeding a configured limit within one window. Confirm per-item notifications stop at the limit, and exactly one combined counts-only summary arrives at window end. Confirm the grouped summary itself is never suppressed (bypasses the limiter) and contains no message content.
result: [pending]

### 2. Per-type UI render/save/reload
expected: On /replies, /zaps, /messages, /groups: the rate-limit number field renders, saving a value persists it, reload confirms persistence, and other fields on the page are preserved (sibling-preserving PATCH). Setting a limit to 0 = unlimited for that type.
result: [pending]

### 3. /notifications global + window UI (first PATCH route)
expected: On /notifications, the new global-limit and window fields render and save via the page's first-ever PATCH route without breaking the existing GET/dashboard view; window is clamped to a sane floor (0/blank does not disable or busy-loop).
result: [pending]

## Summary

total: 3
passed: 0
issues: 0
pending: 3
skipped: 0
blocked: 0

## Gaps
