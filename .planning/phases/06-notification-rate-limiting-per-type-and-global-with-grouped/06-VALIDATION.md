---
phase: 6
slug: notification-rate-limiting-per-type-and-global-with-grouped
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-10
---

# Phase 6 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `bun test` (Bun built-in) |
| **Config file** | `bunfig.toml` (preloads `tests/setup.ts`, isolates `Bun.env.CONFIG`) |
| **Quick run command** | `bun test tests/services/ tests/helpers/ tests/notifications/` |
| **Full suite command** | `bun test` |
| **Lint (types)** | `bun run lint` (`tsc --noEmit`) |
| **Estimated runtime** | ~seconds (pure accounting unit with an INJECTED clock — no real timers) |

---

## Sampling Rate

- **After every task commit:** the quick run for the touched area + `bun run lint`
- **After every plan wave:** `bun test` (full suite)
- **Before `/gsd-verify-work`:** full suite green AND `bun run lint` clean
- **Max feedback latency:** ~30 seconds

---

## Per-Task Verification Map

> Filled by the planner / nyquist pass. Each behavioral task maps to an automated `bun test` assertion or Manual-Only.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 6-01-01 | 01 | 1 | D6-02/D6-04/D6-05 | — | Under limit delivers; over limit accumulates; exactly one combined grouped summary at window end; counters reset | unit (injected clock) | `bun test tests/services/rate-limit.test.ts` | ❌ W0 | ⬜ pending |
| 6-01-02 | 01 | 1 | D6-06/D6-10 | T-6-01 | Grouped summary bypasses the limiter and carries COUNTS ONLY (never DM plaintext) | unit | `bun test tests/services/rate-limit.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] Pure, clock-injectable rate-limit accounting/summary unit + test (no real timers, no services/nostr.ts import): under-limit-delivers, over-limit-accumulates, one-grouped-summary-per-window, reset, 0=unlimited, per-type-vs-global interaction, counts-only summary
- [ ] `migrateConfig` extended for `rateLimit` config + regression tests (new-install defaults, migration adds defaults, idempotent, malformed guard)
- [ ] Sync round-trip test: `SyncedPrefs` carries rateLimit with an absent-key fallback to LOCAL defaults (never 0/unlimited) + PREFS_VERSION handling

*Existing `bunfig.toml` + `tests/setup.ts` cover config isolation.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Live: heavy activity triggers the limit and a single combined grouped summary ("N mentions, M group messages") arrives at window end | D6-02/04/05 | Requires a live signer + a burst of real events over relays | Generate a burst of qualifying events; confirm per-item notifications stop at the limit and one grouped summary arrives |
| `/messages`,`/replies`,`/zaps`,`/groups` per-type limit fields + `/notifications` global field save/reload | D6-08 | Requires the running web UI (and `/notifications` gains its first PATCH form) | Set each limit, save, reload, confirm persistence; set a limit to 0 and confirm unlimited |

*Automated tests cover the window accounting, grouped-summary formatting (counts only), 0=unlimited, migration/defaults, and sync round-trip with an injected clock.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
