---
phase: 4
slug: add-nip-17-dm-notifications-support-per-applesauce-docs
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-10
---

# Phase 4 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `bun test` (Bun built-in) |
| **Config file** | `bunfig.toml` (preloads `tests/setup.ts`, isolates `Bun.env.CONFIG`) |
| **Quick run command** | `bun test tests/notifications/` |
| **Full suite command** | `bun test` |
| **Lint (types)** | `bun run lint` (`tsc --noEmit`) |
| **Estimated runtime** | ~seconds (in-memory; the new units are network-safe, no live relays) |

---

## Sampling Rate

- **After every task commit:** the quick run command for the touched area + `bun run lint`
- **After every plan wave:** `bun test` (full suite)
- **Before `/gsd-verify-work`:** full suite green AND `bun run lint` clean
- **Max feedback latency:** ~30 seconds

---

## Per-Task Verification Map

> Filled by the planner / nyquist pass. Each behavioral task maps to an automated `bun test` assertion or is listed under Manual-Only.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 4-01-01 | 01 | 1 | D4-02 | T-4-01 / — | A gift wrap present at startup is NOT notified; a new one after startup IS (no drop, no re-notify) | unit | `bun test tests/helpers/gift-wrap-subscription.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `helpers/gift-wrap-subscription.ts` — pure `notifyNewGiftWraps` combinator (no singleton imports) + its test
- [ ] `notifications/gift-wrap-messages.ts` — pure `unlockPrivateDirectMessage` decrypt/classify unit + its test
- [ ] Network-safe tests using `PrivateKeySigner` (exposes `.nip44`) and manual gift-wrap construction; must NOT import `services/nostr.ts` or the `notifications/index.ts` barrel

*Existing `bunfig.toml` + `tests/setup.ts` cover config isolation.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Real gift-wrapped DM from a live signer decrypts and notifies once (not re-notified on restart) | D4-01/D4-02 | Requires a live NIP-46 signer + a real gift-wrapped DM over relays | Connect a signer, receive/send yourself a NIP-17 DM, confirm one notification; restart and confirm no duplicate notification for the same DM |

*Automated tests cover the dedup/high-water logic, unwrap+gate logic, deep-link construction, and the error-guard with a local key signer.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
