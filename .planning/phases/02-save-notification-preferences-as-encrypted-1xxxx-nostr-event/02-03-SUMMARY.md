---
phase: 02-save-notification-preferences-as-encrypted-1xxxx-nostr-event
plan: 03
subsystem: sync
tags: [rxjs, nip-78, nip-44, applesauce-core, applesauce-common, applesauce-relay, kind-30078]

# Dependency graph
requires:
  - phase: 02-01
    provides: "helpers/preferences.ts pure functions (PREFS_KIND, PREFS_NAMESPACE, serializePrefs, mergePrefs, sanitizeSyncedPrefs, isNewerPrefs, samePrefsPayload)"
  - phase: 02-02
    provides: "SIGNER_PERMISSIONS wired into all NIP-46 signer-connect call sites (sign_event:30078, nip44_encrypt, nip44_decrypt)"
provides:
  - "services/preferences.ts — the reactive singleton that publishes local notification-rule changes as a self-encrypted kind-30078 event and subscribes/applies remote updates"
  - "enabled$ — the D2-12 sync-active signal (config$ + signer$ gated) for a future UI hint / /status"
  - "index.ts boots the service at process start via a side-effect import"
affects: [02-04]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Local shareAndHold() duplicate (services/nostr.ts's helper is unexported) reused for enabled$ and preferencesEvent$"
    - "withTimeout() Promise.race helper wraps every signer round-trip (getPublicKey, nip44.encrypt, signEvent, unlockAppData) at 8s, per Pitfall 3 (NostrConnectSigner has no built-in timeout)"
    - "Payload-equality loop prevention via module-scope lastKnownPayloadJSON, set both after a successful publish and (before updateConfig) after applying a remote update — explicitly not the giftWraps$ skip(1) idiom (D2-09, Pitfall 5)"
    - "D2-08 high-water-mark (lastAppliedCreatedAt) checked before the expensive decrypt in the apply pipeline"

key-files:
  created: [services/preferences.ts]
  modified: [index.ts]

key-decisions:
  - "Narrowed signer.nip44 (typed optional on NostrConnectAccount) with an in-try throw rather than an early-return gate, so the D2-14-corrected 'never actually undefined' assumption is compiler-safe without changing the degrade-to-local-only-on-failure behavior — the throw is caught by the same catch block as any other signer round-trip failure"
  - "Used the object-form eventStore.replaceable({kind, pubkey, identifier}) exclusively (never the positional/no-identifier form) for the addressable kind-30078 read, per Pitfall 2"
  - "unlockAppData(event, signer) is awaited inside withTimeout, then getAppDataContent(event) reads the cached decrypted result synchronously — matches the plan's exact two-step sequence"

requirements-completed: [D2-01, D2-02, D2-03, D2-07, D2-08, D2-09, D2-10, D2-11, D2-12, D2-14, D2-15]

coverage:
  - id: D1
    description: "Debounced (1.5s) publish pipeline: config$ change -> serializePrefs -> equality guard -> self-encrypt (NIP-44) -> sign kind-30078 with stable d-tag -> publish to outbox relays (fallback lookupRelays)"
    requirement: "D2-01/D2-02/D2-03/D2-07/D2-10"
    verification:
      - kind: unit
        ref: "bun run lint (tsc --noEmit) + structural greps (lastKnownPayloadJSON, withTimeout, debounceTime(1500), nip44.encrypt)"
        status: pass
    human_judgment: true
    rationale: "Live behavior (a connected bunker actually publishing to real relays) requires a live NIP-46 signer session, per the plan's Manual verification note — carried to /gsd-verify-work"
  - id: D2
    description: "Live REQ + reactive replaceable read + decrypt-in-switchMap apply pipeline: high-water-mark gate before decrypt, sanitizeSyncedPrefs validation, mergePrefs+updateConfig, with lastKnownPayloadJSON set before updateConfig to prevent a republish loop"
    requirement: "D2-08/D2-09/D2-11"
    verification:
      - kind: unit
        ref: "bun run lint (tsc --noEmit) + structural greps (isNewerPrefs, sanitizeSyncedPrefs, unlockAppData, identifier: PREFS_NAMESPACE, reconnect: Infinity, resubscribe: true)"
        status: pass
    human_judgment: true
    rationale: "Confirming a second client actually decrypts the same prefs and that the loop-prevention marker suppresses a republish requires two live signer sessions — carried to /gsd-verify-work"
  - id: D3
    description: "No-signer / offline-bunker graceful degradation: local config.json save is untouched, no publish/subscribe attempted, signer round-trips never hang the pipeline"
    requirement: "D2-12/D2-14/D2-15"
    verification:
      - kind: unit
        ref: "bun test (full suite, 45/45 pass, no test imports services/preferences.ts or services/nostr.ts per Pitfall 6) + git diff confirms services/config.ts is unchanged"
        status: pass
    human_judgment: true
    rationale: "Timeout-firing behavior against an actually-offline bunker requires a live disconnect scenario — carried to /gsd-verify-work"

# Metrics
duration: 25min
completed: 2026-07-09
status: complete
---

# Phase 02 Plan 03: Reactive Publish/Subscribe Sync Pipeline for Notification Preferences Summary

**Built `services/preferences.ts`, the reactive singleton that debounced-publishes local notification-rule changes as a NIP-44-self-encrypted kind-30078 event to outbox relays, and subscribes to/applies newer remote updates via a live REQ + decrypt-in-switchMap pipeline — with timeout-bounded signer round-trips and payload-equality loop prevention, gracefully degrading to today's local-only behavior when no signer is connected.**

## Performance

- **Duration:** ~25 min
- **Tasks:** 2
- **Files modified:** 2 (services/preferences.ts created, index.ts modified)

## Accomplishments

- `services/preferences.ts` created as a module-scope singleton with side effects at import, following the `services/nostr.ts` (`groups$`/`mutedPubkeys$`/`tagged$`) convention exactly
- `enabled$` — the D2-12 sync-active signal, `combineLatest([config$, signer$])` gated on signer presence
- `publishPreferences()` — self-encrypts (`nip44.encrypt(ownPubkey, ...)`, D2-02), builds a manual `EventTemplate` with a stable `d`-tag (D2-01/D2-03), signs, and publishes to outbox relays with a `lookupRelays` fallback (D2-10/Pitfall 7); every signer round-trip (`getPublicKey`, `nip44.encrypt`, `signEvent`) is wrapped in an 8s `withTimeout()` (Pitfall 3)
- Debounced (1.5s) publish pipeline over `config$` with a `distinctUntilChanged` diff-key and a `lastKnownPayloadJSON` equality guard — the D2-09 loop-prevention primitive, explicitly not the `giftWraps$` `skip(1)` idiom (Pitfall 5)
- `preferencesEvent$` — reactive `eventStore.replaceable({kind, pubkey, identifier: PREFS_NAMESPACE})` read, always supplying the d-tag identifier (Pitfall 2)
- A live `pool.subscription` REQ (`reconnect: Infinity, resubscribe: true`, `authors:[user]` scoped) feeding `eventStore` (D2-11, T-02-08 authorship guard)
- The decrypt-and-apply pipeline: D2-08 high-water-mark (`lastAppliedCreatedAt`) gate *before* the timeout-wrapped `unlockAppData` decrypt, `sanitizeSyncedPrefs` validation (ASVS V5) of the untrusted payload, `mergePrefs` + `updateConfig`, with `lastKnownPayloadJSON` set synchronously *before* `updateConfig` so the resulting `config$` echo no-ops the publish pipeline (D2-09 ordering)
- `index.ts` boots the service at process start via `import "./services/preferences";` beside the existing `import "./notifications";`
- `services/config.ts` intentionally left unmodified — the save-on-change write always runs, so a local setting is never lost even if the nostr publish fails (D2-15)

## Task Commits

Each task was committed atomically:

1. **Task 1: Create services/preferences.ts with enabled$ and the debounced publish pipeline** — `31e3bf2`
2. **Task 2: Add the subscribe-and-apply pipeline and boot the service from index.ts** — `b5fa144`

## Files Created/Modified

- `services/preferences.ts` (new) — `enabled$`, `preferencesEvent$`, `publishPreferences()`, the debounced publish pipeline, the live REQ subscription, and the decrypt-and-apply pipeline; module-scope `lastKnownPayloadJSON` and `lastAppliedCreatedAt` conflict state; local `withTimeout()` and `shareAndHold()` helpers
- `index.ts` — added `import "./services/preferences";` beside the existing `import "./notifications";`

## Decisions Made

- **`signer.nip44` compiler-narrowing without a behavioral gate:** `NostrConnectAccount.nip44` is typed `ISigner["nip44"] | undefined`, but per RESEARCH.md Pitfall 3/D2-14's correction it is never actually `undefined` for the wired signer type. Rather than an early-return null check (which RESEARCH.md explicitly warns against as a behavioral gate), the code captures `const nip44 = signer.nip44` inside the existing `try` block and throws if falsy — TypeScript-safe, and if the impossible case ever occurred, the throw is caught by the same catch block as any other signer-round-trip failure, degrading to local-only + log exactly per D2-15. This is a type-narrowing technicality, not a new behavior path.
- **`eventStore.replaceable` object-form only:** Always used `{kind, pubkey, identifier: PREFS_NAMESPACE}`, never the 2-arg positional form, per Pitfall 2 (kind-30078 is addressable, and omitting the identifier risks matching an unrelated 30078 event for the same pubkey).
- **`unlockAppData` + `getAppDataContent` two-step read:** `unlockAppData(event, signer)` (awaited inside `withTimeout`) decrypts and caches the result on the event via a symbol; `getAppDataContent<unknown>(event)` then reads that cache synchronously — matches the plan's exact prescribed sequence and the verified `applesauce-common/helpers/app-data` API shape (confirmed via `node_modules/applesauce-common/dist/helpers/app-data.d.ts` during execution, since `node_modules` was not present at plan-execution start and had to be installed via `bun install` first).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking issue] `node_modules` was absent at execution start**
- **Found during:** Task 1, before any code was written
- **Issue:** The worktree had no `node_modules/` directory, so `bun run lint`/`bun test` and all API-shape verification against the installed `applesauce-*@6.1.0` packages (referenced throughout 02-RESEARCH.md) were impossible.
- **Fix:** Ran `bun install` (all 46 packages resolved from the existing `bun.lock`/`package.json`, zero new dependencies — matches RESEARCH.md's "no package installs this plan" claim). `bun.lock` was unchanged by the install (confirmed via `git diff --stat`).
- **Files modified:** None (node_modules is gitignored; no lockfile drift)
- **Commit:** N/A — no tracked files changed by this step

**2. [Rule 1 - Bug/type-safety] `signer.nip44` possibly-undefined compile error**
- **Found during:** Task 1, first `bun run lint` run
- **Issue:** `tsc --noEmit` reported `TS18048: 'signer.nip44' is possibly 'undefined'` at the `nip44.encrypt(...)` call site — the plan's action text called for reading `signer.nip44.encrypt` directly without an intermediate narrowing step.
- **Fix:** Added a local `const nip44 = signer.nip44; if (!nip44) throw new Error(...)` inside the existing `try` block, narrowing the type for the compiler while preserving the exact catch/log/degrade-to-local-only behavior on the (per-research, effectively impossible) undefined case. See "Decisions Made" above for full rationale.
- **Files modified:** `services/preferences.ts`
- **Commit:** `31e3bf2`

No other deviations — both tasks otherwise match the plan's action text and RESEARCH.md's Pattern 1/3/4/5 code shapes closely.

## Issues Encountered

None beyond the two auto-fixed items above.

## User Setup Required

None — no external service configuration required. (A live NIP-46 bunker session is required only for the manual verification carried to `/gsd-verify-work`, not for this plan's code to be considered done.)

## Known Stubs

None. Both pipelines are fully wired to the live `config$`/`signer$`/`eventStore`/`pool` singletons — no hardcoded empty values or placeholder data paths.

## Threat Flags

None beyond what the plan's `<threat_model>` already covers (T-02-07 through T-02-13, all addressed as designed: self-encrypt-to-own-pubkey, authors+eventStore pubkey scoping + high-water-mark + sanitize three-layer tampering guard, payload-equality loop prevention, 8s timeouts on every signer round-trip, summary-only logging, lookupRelays fallback for empty mailboxes).

## Next Phase Readiness

- `services/preferences.ts` is a complete, self-booting reactive sync service. Plan 04 (the remaining wave-2/3 work — likely the no-signer UI hint and any manual "sync now" nicety) can now read `enabled$` to gate its UI.
- Manual verification (live bunker publish/subscribe round-trip across two clients, offline-bunker timeout behavior, no-signer local-only confirmation) is deferred to `/gsd-verify-work`, per the plan's `<verification>` section — this requires a live NIP-46 signer session not available in this execution environment.

---
*Phase: 02-save-notification-preferences-as-encrypted-1xxxx-nostr-event*
*Completed: 2026-07-09*

## Self-Check: PASSED

`services/preferences.ts` and `index.ts` verified present on disk with expected content; both commit hashes (`31e3bf2`, `b5fa144`) verified present in `git log --oneline`.
