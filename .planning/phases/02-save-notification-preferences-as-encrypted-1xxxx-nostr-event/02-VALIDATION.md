---
phase: 02
slug: save-notification-preferences-as-encrypted-1xxxx-nostr-event
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-07
---

# Phase 02 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `bun test` (Bun built-in test runner) |
| **Config file** | `bunfig.toml` (`preload = ["./tests/setup.ts"]` — isolates `Bun.env.CONFIG` to a temp copy so tests never clobber the real `config.json`) |
| **Quick run command** | `bun test tests/services/preferences.test.ts` (once created) |
| **Full suite command** | `bun test` |
| **Estimated runtime** | ~1–3 seconds |

---

## Sampling Rate

- **After every task commit:** Run the quick command for the touched module.
- **After every plan wave:** Run `bun test` (full suite) + `bun run lint` (`tsc --noEmit`).
- **Before `/gsd-verify-work`:** Full suite green + lint clean.
- **Max feedback latency:** ~5 seconds.

---

## Per-Task Verification Map

> Filled by the planner (per-task `<verify>`/`<automated>` blocks) and reconciled by the Nyquist auditor after execution. The bulk of Phase 2's logic (serialize/deserialize/merge, `created_at` high-water-mark, feature/permission gating) MUST be extracted as **pure helpers** so they are unit-testable without a live signer/relay.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| TBD | — | — | D2-06 (serialize subset) | — | rules-only payload; never includes signer/pubkey/ntfy | unit | `bun test tests/services/preferences.test.ts` | ❌ W0 | ⬜ pending |
| TBD | — | — | D2-08 (newest-wins) | — | older/equal `created_at` ignored | unit | `bun test` | ❌ W0 | ⬜ pending |
| TBD | — | — | D2-09 (loop prevention) | — | remote-origin update does not republish | unit | `bun test` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/services/preferences.test.ts` — unit stubs for the pure serialize/merge/high-water-mark helpers
- [ ] `tests/fixtures/` — a config fixture + a sample decrypted-prefs JSON fixture
- [ ] Framework already installed (`bun test` + `bunfig.toml` + `tests/setup.ts` exist)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Live publish → other-client read-back round trip | D2-07/D2-11 | Requires a connected NIP-46 bunker + a second client/relay; no signer harness in tests | With a signer connected, change a rule, confirm a kind-30078 event is published to outbox relays and a second client decrypts the same prefs |
| No-signer degradation UI hint | D2-12 | Visual/interaction, read-only session | With no signer, confirm local save still works and the "connect a signer to sync" hint shows; no publish attempted |
| Bunker-offline resilience | D2-15 | Requires an unresponsive bunker | Confirm local save succeeds and the timeout wrapper fires without hanging when the bunker is offline |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
