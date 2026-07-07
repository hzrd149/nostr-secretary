---
phase: 1
slug: nip-29-group-notification-modes
status: approved
nyquist_compliant: true
wave_0_complete: false
created: 2026-07-07
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Authored from `01-RESEARCH.md` § "Validation Architecture" (HIGH confidence).

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `bun:test` — Bun's built-in test runner (Bun 1.3.14 installed). No third-party framework; no install needed. Currently unused by any repo file (from-scratch Wave 0 per `.planning/codebase/TESTING.md`). |
| **Config file** | none — `bun:test` needs no config; a `"test": "bun test"` script is added to `package.json` in Plan 01-01 (none exists today). |
| **Quick run command** | `bun test tests/helpers/groups.test.ts` |
| **Full suite command** | `bun test` |
| **Estimated runtime** | ~2–5 seconds (pure synchronous unit tests; no network, no RelayPool/EventStore boot) |

---

## Sampling Rate

- **After every task commit:** Run `bun test tests/helpers/groups.test.ts` (fastest — covers the pure logic that is the actual risk surface).
- **After every plan wave:** Run `bun test` (full suite).
- **Before `/gsd-verify-work`:** Full suite must be green; UI rows (D-03/D-04) and the summary card (D-05 render) verified manually against a running `bun run dev` (no Playwright config exists yet — adding one is out of scope for this phase).
- **Max feedback latency:** ~5 seconds.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 01-01-01 | 01 | 1 | D-01/D-02/D-05/D-06 | T-01-M1 | `messageMentionsPubkey` scans untrusted content via bounded applesauce tokenizer (no custom regex) | unit | `bun test tests/helpers/groups.test.ts` | ❌ W0 | ⬜ pending |
| 01-01-02 | 01 | 1 | ASVS V5 | T-01-M1b | `isGroupNotificationMode` rejects every non-enum value | unit | `bun test tests/helpers/groups.test.ts` | ❌ W0 | ⬜ pending |
| 01-02-01 | 02 | 2 | D-10 | — | `groups.modes` round-trips through `config.json` persistence | unit | `bun test tests/services/config.test.ts` | ❌ W0 | ⬜ pending |
| 01-02-02 | 02 | 2 | D-06/D-10 | — | Migration backfill: pre-`modes` config loads with `modes === {}` (not `undefined`) | unit | `bun test tests/services/config.test.ts` | ❌ W0 | ⬜ pending |
| 01-03-01 | 03 | 3 | D-08/D-09 | — | Mode gate sits strictly between `enabled$` master switch and unchanged `shouldNotify` | integration | `bun test tests/notifications/groups.test.ts` | ❌ W0 | ⬜ pending |
| 01-04-01 | 04 | 3 | D-03/D-04 | T-01-01 | `/groups` PATCH validates each `mode_N` with `isGroupNotificationMode` before writing `config$` | e2e/manual | `bun run lint` + manual UAT | ❌ manual | ⬜ pending |
| 01-05-01 | 05 | 3 | D-05 | — | `/notifications` Groups card shows correct per-mode counts | manual | `bun run lint` + manual UAT (`summarizeGroupModes` unit-tested in 01-01) | ❌ manual | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `package.json` — add `"test": "bun test"` script (Plan 01-01; none exists today)
- [ ] `tests/helpers/groups.test.ts` — D-01/D-02/D-05/D-06 pure functions + `isGroupNotificationMode` (Plan 01-01)
- [ ] `tests/services/config.test.ts` — D-10 round-trip + migration backfill; point `Bun.env.CONFIG` at the fixture before importing `services/config.ts` (top-level `await fs.exists` side effects on import) (Plan 01-02)
- [ ] `tests/fixtures/config-pre-modes.json` — pre-Phase-1 `config.json` (`groups` present, no `modes` key) for the migration test (Plan 01-02)
- [ ] `tests/notifications/groups.test.ts` — D-09 truth table via the exported pure gate + a stubbed `shouldNotify` (do NOT boot the live RelayPool subscription) (Plan 01-03)

*No test infrastructure of any kind exists yet — this is a from-scratch Wave 0, matching `.planning/codebase/TESTING.md`'s "None configured" finding.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| `/groups` renders one row per joined group with picture+name+mode dropdown, mode preselected | D-03/D-04 | No Playwright config exists; adding one exceeds this phase's scope | `bun run dev`, open `/groups`, confirm each joined group shows a row with its metadata and the correct preselected mode; change a mode, Save, reload, confirm it persisted |
| `/groups` row falls back gracefully when kind-39000 metadata is slow/missing | D-04 / Pitfall 3 | Depends on live relay timing | With a group whose metadata relay is slow/unreachable, confirm the row still renders ("Unnamed group" + placeholder avatar) and its dropdown stays functional |
| `/notifications` Groups card shows correct per-mode summary counts and links to `/groups` | D-05 | Rendered aggregate; `summarizeGroupModes` itself is unit-tested | `bun run dev`, open `/notifications`, confirm the Groups card count line matches the configured modes |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies (UI rows D-03/D-04/D-05 are documented manual-only; no Playwright harness this phase)
- [x] Sampling continuity: no 3 consecutive tasks without automated verify (every plan except the two pure-UI renders has a `bun test` gate; those two carry `bun run lint` + manual UAT)
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 5s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-07-07
