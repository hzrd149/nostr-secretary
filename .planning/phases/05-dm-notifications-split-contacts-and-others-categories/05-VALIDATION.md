---
phase: 5
slug: dm-notifications-split-contacts-and-others-categories
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-10
---

# Phase 5 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `bun test` (Bun built-in) |
| **Config file** | `bunfig.toml` (preloads `tests/setup.ts`, isolates `Bun.env.CONFIG`) |
| **Quick run command** | `bun test tests/services/config.test.ts tests/notifications/ tests/helpers/` |
| **Full suite command** | `bun test` |
| **Lint (types)** | `bun run lint` (`tsc --noEmit`) |
| **Estimated runtime** | ~seconds (network-safe units + config migration) |

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
| 5-01-01 | 01 | 1 | D5-01/D5-02 | — | A followed sender → contacts; a non-followed OR unavailable-follow-list sender → others | unit | `bun test tests/notifications/` | ❌ W0 | ⬜ pending |
| 5-01-02 | 01 | 1 | D5-04/D5-05/D5-06 | — | New install: contacts.enabled=true, others.enabled=false; migration seeds both from old messages.enabled | unit | `bun test tests/services/config.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] Pure category-classifier unit (e.g. `classifyDmSender(pubkey, followSet)` / `isContact`) + test — network-safe, no `services/nostr.ts` import
- [ ] `migrateConfig` extended for `messages.contacts`/`messages.others` + regression tests (new-install defaults AND migration-preserves-behavior)
- [ ] Sync round-trip test: `serializePrefs`/`sanitizeSyncedPrefs` carry the two category flags (incl. old-schema / version-bump handling per RESEARCH Pitfall 5)

*Existing `bunfig.toml` + `tests/setup.ts` cover config isolation.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Live: a DM from a followed user notifies (contacts on) while a DM from a non-followed user is suppressed when others is off | D5-01/D5-07/D5-09 | Requires a live signer + real follow list + real DMs (both NIP-04 and NIP-17) | Connect a signer with a kind-3 follow list; receive a DM from a followed and a non-followed sender; confirm categorization + per-category gating for both DM types |
| `/messages` two-section UI saves both category toggles and they round-trip | D5-08 | Requires the running web UI | Open /messages, toggle Contacts/Others, save, reload, confirm persisted |

*Automated tests cover classification (incl. unavailable→others), per-category gate logic, migration/defaults, and sync round-trip with a local key signer.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
