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
| **Quick run command** | `bun test tests/helpers/preferences.test.ts` (pure-helper tests; per Pitfall 6 there is intentionally NO `tests/services/preferences.test.ts`) |
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
| 02-01-01 | 01 | 1 | D2-04/05/06 (serialize subset) | T-02-01 | rules-only payload; never includes signer/pubkey/server/topic/email/lookupRelays/sendContent/groupLink | unit | `bun test tests/helpers/preferences.test.ts` | ❌ W0 | ⬜ pending |
| 02-01-01 | 01 | 1 | D2-08 (newest-wins HWM) | — | older/equal `created_at` ignored (`isNewerPrefs`) | unit | `bun test tests/helpers/preferences.test.ts` | ❌ W0 | ⬜ pending |
| 02-01-01 | 01 | 1 | D2-06 (merge preserves local-only fields) | T-02-02 | inbound merge never clobbers signer/ntfy/pubkey | unit | `bun test tests/helpers/preferences.test.ts` | ❌ W0 | ⬜ pending |
| 02-02-01 | 02 | 1 | D2-13 (permissions expanded + wired) | T-02-03 | `SIGNER_PERMISSIONS` contains `sign_event:30078`/`nip44_encrypt`/`nip44_decrypt` | unit | `bun test tests/const.test.ts` | ❌ W0 | ⬜ pending |
| 02-03-* | 03 | 2 | D2-09/14/15 (loop prevention, timeout, degrade) | T-02-08 | service-level: manual verification (no live-service test per Pitfall 6) | manual | see Manual-Only table | — | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/helpers/preferences.test.ts` (02-01) — unit tests for the pure serialize/merge/high-water-mark/validation helpers
- [ ] `tests/const.test.ts` (02-02) — asserts `SIGNER_PERMISSIONS` contains the required NIP-46 permission tokens
- [ ] `tests/fixtures/` — a config fixture + a sample decrypted-prefs JSON fixture
- [ ] Framework already installed (`bun test` + `bunfig.toml` + `tests/setup.ts` exist)
- [ ] `services/preferences.ts` RxJS-wiring has NO direct unit test (Pitfall 6 / WR-04 precedent) — covered by Manual-Only verifications instead

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
