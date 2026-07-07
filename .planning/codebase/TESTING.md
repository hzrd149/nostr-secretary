# Testing Patterns

**Analysis Date:** 2026-07-07

## Test Framework

**Runner:**
- None configured. No test runner, test files, or test config exist in the repository.
- `package.json` scripts: `dev`, `lint` (`tsc --noEmit`), `format` (`prettier --write .`). No `test` script defined.
- No `vitest.config.*`, `jest.config.*`, `bunfig.toml` test section, or `playwright.config.*` present.

**Assertion Library:**
- None. Bun's built-in `bun:test` is available (Bun is the runtime, `@types/bun` is in `devDependencies`) but is not used by any source file.

**Run Commands:**
```bash
bun run lint     # Type-check only (tsc --noEmit) — the only verification gate
bun run format   # Prettier format
bun run dev      # Start dev server with --watch
```

## Test File Organization

**Location:**
- No tests exist. No `test/`, `tests/`, `__tests__/`, or `*.test.*` / `*.spec.*` files anywhere in the project (verified via filesystem search).

**Naming:**
- Not applicable — no convention established.

**Structure:**
- Not applicable.

## Test Structure

**Suite Organization:**
- Not applicable — no tests written.

**Patterns observed in source that tests would need to handle:**
- Modules in `services/` and `notifications/` execute side effects at import time (subscriptions, config loading, relay connections). Importing `services/nostr.ts` or any `notifications/*` file triggers network connections and filesystem reads. Tests must mock or stub these before import.
- `services/config.ts` reads `Bun.env.CONFIG ?? "config.json"` and either loads or creates the file on import (lines 84-114). Tests must point `CONFIG` at a temp path or mock `fs.promises`.
- `services/nostr.ts` instantiates `RelayPool` and binds `NostrConnectSigner.subscriptionMethod`/`publishMethod` at module scope (lines 60-67). Tests need to stub `RelayPool` before this module loads.
- `notifications/index.ts` imports `./replies`, `./zaps`, `./messages`, `./groups`, each of which subscribes to observables on load. Tests for individual notification modules must import the specific module, not the barrel.

## Mocking

**Framework:** None configured.

**Recommended approach (inferred from codebase):**
- Bun's `bun:test` mock module API would fit the runtime: `import { mock, mockModule } from "bun:test"`
- RxJS observables can be replaced with `of(...)`, `EMPTY`, `NEVER`, or `TestScheduler` from `rxjs/testing` without mocking frameworks — the codebase already imports these operators extensively
- `firstValueFrom` is the standard bridge from observable to Promise (used in every `notifications/*` and many `pages/*`). Tests can replace source observables with `of(testEvent)` and assert on the async result.

**What to Mock:**
- `RelayPool` and `pool.relay(url)` — `services/nostr.ts:60`. Network I/O. Replace with a stub returning canned `request()`/`subscription()` observables.
- `EventStore` — `services/nostr.ts:59`. Replace with a real `EventStore` instance populated with test events, or stub `eventStore.event(...)`, `eventStore.profile(...)`, `eventStore.replaceable(...)`, `eventStore.addressable(...)`.
- `NostrConnectSigner` and `signer$` — `services/nostr.ts:122`. Stub `unlockGiftWrap`, `unlockLegacyMessage`, `relay.authenticate`.
- `fetch` in `services/ntfy.ts:198` — global `fetch` is used directly. Mock with `globalThis.fetch = mock(() => new Response(...))` or Bun's `mock.module`.
- `fs/promises` in `services/config.ts` — mock `exists`, `readFile`, `writeFile`.
- `config$.next(...)` — the `BehaviorSubject` in `services/config.ts:54` is the source of truth. Tests can import the real `config$` and call `config$.next({...})` to set state, or stub via `mock.module`.

**What NOT to Mock:**
- `applesauce-core` pure helpers (`getNip10References`, `getDisplayName`, `getProfilePicture`, `addRelayHintsToPointer`, `encodeGroupPointer`) — these are deterministic pure functions over event objects. Test them with real inputs.
- `helpers/link.ts` template substitution — pure string manipulation over `config$.getValue()`. Test by setting config state.
- `helpers/array.ts` `unique` — trivial pure function.
- `NtfyServiceError` class — instantiate and assert on `.code`, `.httpStatus`, `.message`, `.name`.

## Fixtures and Factories

**Test Data:**
- No fixtures or factories exist.
- `nostr-tools` events can be constructed with `finalizeEvent`/`generateSecretKey` from `nostr-tools/pure` for test events. The codebase imports `NostrEvent` as a type (`helpers/groups.ts:7`, `helpers/link.ts:9`) but does not construct events itself (it only consumes events from relays).
- Real-world NIP event structures needed for fixtures: kind 1 (text notes), kind 4 (NIP-04 DMs), kind 14 (private DMs), kind 9734/9735 (zap request/receipt), kind 1059 (gift wraps), kind 39000 (group metadata), kind 10000 (mute lists), kind 10009 (groups list).

**Location:**
- Not established. Recommend `test/fixtures/` for static event JSON and `test/factories.ts` for builder helpers if tests are added.

## Coverage

**Requirements:** None enforced. No coverage tooling configured.

**View Coverage:**
```bash
# Not available — no coverage tool installed
```

## Test Types

**Unit Tests:**
- Not present. Best candidates for first unit tests:
  - `helpers/link.ts` — `buildOpenLink`, `buildGroupLink`, `addCommonTags` are pure functions over config + event. High value, low mocking cost.
  - `helpers/lists.ts` — `loadLists` requires mocking `mailboxes$` and `eventStore` but logic is complex (naddr parsing, coordinate parsing, Promise.allSettled).
  - `services/ntfy.ts` — `sendNotification` header construction is pure given `fetch` mock. Validates header mapping for priority/tags/actions.
  - `helpers/array.ts` — `unique` is trivially testable.
  - `helpers/observable.ts` — `getValue` wraps `defined()` + `simpleTimeout`; test with `of(undefined)` and `of(value)`.

**Integration Tests:**
- Not present. The notification modules (`notifications/replies.ts`, `notifications/zaps.ts`, `notifications/messages.ts`, `notifications/groups.ts`) are the primary integration surface — they wire `tagged$`/`giftWraps$` through `shouldNotify` to `sendNotification`. Integration tests would feed test events into a stubbed `tagged$` and assert `sendNotification` was called with the expected payload.

**E2E Tests:**
- Not present. `.cursor/rules/datastar-testing.mdc` documents the intended approach: Playwright against the running Bun server, testing user-visible results (DOM content after SSE patches, navigation after actions). No Playwright config or test files exist.
- The Datastar testing rule prescribes: wait for DOM changes with `waitForSelector`, never use `waitForTimeout`, test the result not the SSE mechanism, test that state persists across reloads.

## Common Patterns

**Async Testing:**
- Not applicable — no tests. When added, all notification handlers are `async` and use `firstValueFrom` to bridge observables to promises; tests should `await` the handler's effect and assert on `sendNotification` mock calls.

**Error Testing:**
- Not applicable. The codebase has well-defined error paths worth covering:
  - `NtfyServiceError` thrown from `sendNotification` for missing server/topic/message (`services/ntfy.ts:138-141`)
  - `NtfyServiceError` wrapping non-OK HTTP responses with `code` and `httpStatus` (`services/ntfy.ts:204-218`)
  - Route `PATCH`/`POST` handlers catch errors and emit `stream.patchSignals(JSON.stringify({ error: ... }))` — tests should verify the error signal shape
  - RxJS `catchError` in `notifications/messages.ts:166` and `notifications/groups.ts:87` swallows errors and returns `EMPTY`; tests should verify the subscription survives a failed `unlockGiftWrap`

## Cursor Rules (Testing Guidance)

`.cursor/rules/datastar-testing.mdc` is committed as project guidance (alwaysApply: true). It prescribes the testing philosophy for any future Datastar UI tests:

- **Test the result, not the mechanism** — assert on visible DOM content, not SSE event structure or Datastar signal internals
- **Playwright is the preferred tool** for reactive UI testing
- **Wait for specific conditions** (`waitForSelector`, `waitForFunction`, `waitForURL`), never arbitrary `waitForTimeout`
- **Test full user workflows** — form submission → success message → navigation, not individual SSE operations
- **Test persistence across reloads** — Datastar pages should be re-loadable (see also `.cursor/rules/datastar.mdc`)

---

*Testing analysis: 2026-07-07*
