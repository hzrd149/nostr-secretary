---
phase: 07
slug: default-rate-limit-for-chat-groups-and-dms-on-join
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-13
---

# Phase 07 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `bun:test` (Bun built-in) |
| **Config file** | `bunfig.toml` (`[test] preload = tests/setup.ts` — shared module-cache-safe test setup) |
| **Quick run command** | `bun test` |
| **Full suite command** | `bun test && bun run lint` |
| **Estimated runtime** | ~5–10 seconds |

---

## Sampling Rate

- **After every task commit:** Run `bun test`
- **After every plan wave:** Run `bun test && bun run lint`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

> Filled by the planner from the `## Validation Architecture` section of 07-RESEARCH.md.
> The pure clock-injectable `services/rate-limit-accounting.ts` unit carries the bulk of
> coverage (per-context isolation, lazy-create, window-prune, most-restrictive-wins layering,
> overflow roll-up into per-type counts, `0 = unlimited`); config-migration + kind-30078 sync
> round-trip get regression tests; live burst → grouped summary and the two new default UI
> fields are UAT-only.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| {N}-01-01 | 01 | 1 | D7-XX | T-07-01 / — | {expected secure behavior or "N/A"} | unit | `bun test` | ✅ / ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] Existing infrastructure covers all phase requirements — `bun:test` + `bunfig.toml` preload
      already established in Phase 1; extend `tests/services/rate-limit-accounting.test.ts`
      (injected clock) rather than installing anything new.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Live burst in a busy NIP-29 group / new DM conversation is throttled to its own default bucket and rolls into the counts-only grouped-overflow summary | D7-01/04/07 | Requires a live signer, real relay traffic, and a phone receiving ntfy notifications | Join/subscribe to a high-traffic group, trigger >perGroup messages within the window; confirm one grouped summary instead of N notifications |
| Two new default fields (default-per-group on /groups, default-per-DM on /messages) save via PATCH and survive reload + kind-30078 sync | D7-05/08 | Requires the running UI + live signer for encrypted sync round-trip | Set defaults in UI, reload, confirm persisted; verify on a second device/client |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] `nyquist_compliant: true` set in frontmatter
- [ ] Feedback latency < 15s

**Approval:** pending
