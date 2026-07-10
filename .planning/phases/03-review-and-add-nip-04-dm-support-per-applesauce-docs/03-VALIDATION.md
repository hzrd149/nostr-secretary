---
phase: 3
slug: review-and-add-nip-04-dm-support-per-applesauce-docs
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-09
---

# Phase 3 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `bun test` (Bun built-in) |
| **Config file** | `bunfig.toml` (preloads `tests/setup.ts`, which isolates `Bun.env.CONFIG` to a temp fixture) |
| **Quick run command** | `bun test tests/notifications/messages.test.ts tests/const.test.ts` |
| **Full suite command** | `bun test` |
| **Lint (types)** | `bun run lint` (`tsc --noEmit`) |
| **Estimated runtime** | ~seconds (in-memory, no network in tests) |

---

## Sampling Rate

- **After every task commit:** Run the quick run command for the touched area, plus `bun run lint`
- **After every plan wave:** Run `bun test` (full suite)
- **Before `/gsd-verify-work`:** Full suite green AND `bun run lint` clean
- **Max feedback latency:** ~30 seconds

---

## Per-Task Verification Map

> Filled by the planner / nyquist pass from PLAN.md tasks. Each behavioral task must map to an automated `bun test` assertion or be listed under Manual-Only below.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 3-01-01 | 01 | 1 | D3-02 | T-3-01 / — | `nip04_decrypt` present in `SIGNER_PERMISSIONS` so bunker grants kind-4 decryption | unit | `bun test tests/const.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/notifications/messages.test.ts` — new; NIP-04 decrypt + `shouldNotify` gates, network-safe (do NOT import `notifications/index.ts`; use `PrivateKeySigner` fixture; avoid uncached `eventStore.profile/replaceable` loader fetches)
- [ ] `tests/const.test.ts` — extend with a `nip04_decrypt` presence assertion

*Existing `bunfig.toml` + `tests/setup.ts` infrastructure covers config isolation.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Fresh NIP-46 bunker connect actually grants `nip04_decrypt` and a real kind-4 DM decrypts | D3-02 | Requires a live remote signer/bunker session | Connect a signer, send yourself a legacy DM, confirm the notification fires with decrypted content when `sendContent` on |
| Reconnect hint appears when an already-connected signer lacks the permission | D3-07 | Requires a live signer without the permission | Use a pre-existing signer session, trigger a NIP-04 DM, confirm the non-blocking reconnect hint shows |

*Automated tests cover permission-set contents, decrypt/gate logic with a local key signer, migration default, and deep-link construction.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
