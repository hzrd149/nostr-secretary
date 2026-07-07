# Codebase Concerns

**Analysis Date:** 2026-07-07

## Tech Debt

### Duplicated `shouldNotify` helper

- Issue: The `shouldNotify(pubkey)` function is copy-pasted nearly verbatim across four notification modules. Only the config key (`messages` | `replies` | `zaps` | `groups`) and the observable accessor (`getValue` vs `firstValueFrom`) differ.
- Files:
  - `notifications/messages.ts:41-69`
  - `notifications/replies.ts:25-53`
  - `notifications/zaps.ts:26-54`
  - `notifications/groups.ts:40-68`
- Impact: Any change to mute/whitelist/blacklist semantics must be applied in four places. Drift between copies is likely. Note that `messages.ts` uses `getValue(whitelist$)` from `helpers/observable.ts` while the others use `firstValueFrom(whitelist$)` — already an inconsistency.
- Fix approach: Extract a single `createShouldNotify(section: "messages" | "replies" | "zaps" | "groups")` factory into `helpers/` (or onto `services/nostr.ts`) and import it in each notification module.

### Duplicated signer / QR setup across pages

- Issue: Both `pages/home.tsx` and `pages/signer.tsx` declare their own `newSigner$ = new BehaviorSubject<NostrConnectSigner | null>(null)` and render an identical "create signer, call `waitForSigner()`, build QR URL via `api.qrserver.com`, handle POST" flow.
- Files:
  - `pages/home.tsx:238-340` (`SetupComponent`) and `:342` (`newSigner$`) and `:428-463` (POST handler)
  - `pages/signer.tsx:13` (`newSigner$`), `:15-164` (`SetupPage`), `:254-296` (POST handler)
- Impact: Two independent `newSigner$` subjects hold two separate pending signers if the user visits both pages. Behavior is subtly different: `home.tsx` patches the whole `HomeView` on success, while `signer.tsx` patches only `#content`. Drift is already visible (signer.tsx renders duplicate `saved`/`error` blocks at lines 40-50 and 87-101).
- Fix approach: Move signer creation and the QR/connect UI into a single shared component + a single shared `newSigner$` in `services/nostr.ts` (or a dedicated `services/signer-setup.ts`).

### Dead / no-op code

- Issue: Several lines do nothing or duplicate work.
- Files:
  - `pages/config.tsx:204` — orphan `currentConfig;` expression statement (left over from a refactor).
  - `services/nostr.ts:127-128` — `configValue("signer").pipe().subscribe(...)` uses an empty `.pipe()` call, which is a no-op.
  - `pages/signer.tsx:33-36` — `connectUrl` is computed from `getNostrConnectURI()` then `qrCodeUrl` calls `getNostrConnectURI()` a second time instead of reusing `connectUrl`.
- Impact: Confusing for future maintainers; minor wasted work.
- Fix approach: Remove `currentConfig;`. Drop the empty `.pipe()`. Reuse `connectUrl` in the `qrCodeUrl` template.

### `helpers/groups.ts` duplicates `subscribeToGroup` and is unused

- Issue: `getGroupMetadata(group)` in `helpers/groups.ts:11-26` performs the same `pool.relay(group.relay).request({kinds:[39000], "#d":[group.id]})` query that `subscribeToGroup` in `notifications/groups.ts:70-95` already issues (and caches as part of its `combineLatest`). A `grep` for `getGroupMetadata` shows no callers.
- Files: `helpers/groups.ts:9-26`, `notifications/groups.ts:70-95`
- Impact: Dead module; its `cache = new Map()` is never populated. Future maintainers may call it expecting warmed cache.
- Fix approach: Delete `helpers/groups.ts`, or refactor `subscribeToGroup` to use it.

### Inconsistent navigation patterns

- Issue: Some buttons use Datastar expressions (`data-on-click="window.location.href='/foo'"`), others use raw HTML `onclick=` attributes.
- Files:
  - Raw `onclick`: `pages/notifications.tsx:312,319`, `pages/status.tsx:255,436,442,449`, `pages/mobile.tsx:108,135`
  - Datastar `data-on-click`: `pages/config.tsx:153`, `pages/signer.tsx:147,154,195`, etc.
- Impact: Mixed mental model; the `.cursor/rules/datastar.mdc` rule says to keep pages re-loadable, but raw `onclick` bypasses Datastar signal awareness.
- Fix approach: Standardize on `data-on-click` for navigation across all pages.

### Pervasive inline styles instead of CSS classes

- Issue: Nearly every TSX page places large `style={{ ... }}` blocks on elements rather than adding classes to the existing `public/{layout,form,button}.css` files. Several pages also embed `<style>{`...`}</style>` blocks inline (`pages/home.tsx:16-112`, `pages/notifications.tsx:9-154`, `pages/status.tsx:7-156`).
- Files: `pages/home.tsx`, `pages/signer.tsx`, `pages/config.tsx`, `pages/messages.tsx`, `pages/replies.tsx`, `pages/zaps.tsx`, `pages/groups.tsx`, `pages/mobile.tsx`, `pages/notifications.tsx`, `pages/status.tsx`
- Impact: Styling changes require editing many files; no theming; large HTML payloads per response.
- Fix approach: Promote repeated inline styles to classes in `public/*.css` and reference by class name.

## Known Bugs

### `signer.tsx` renders duplicate success/error message blocks

- Symptoms: The signer setup page shows two "✅ Signer configuration updated successfully!" banners and two "❌ Error:" banners simultaneously when `$saved` or `$error` is true.
- Files: `pages/signer.tsx:40-50` and `:87-101` (both `<div class="success-message" data-show="$saved">`), plus `:45-50` and `:95-101` for errors.
- Trigger: Visit `/signer` while `config.signer` is null and trigger any patch/post that sets `$saved` or `$error`.
- Workaround: None — cosmetic but confusing.

### `home.tsx` SetupComponent references `newSigner$` before its declaration

- Symptoms: No runtime error today (function hoisting + module-eval timing save it), but `SetupComponent` (defined at line 238) closes over `newSigner$` which is declared at line 342. The `HomeView` function at line 344 calls `<SetupComponent />` after the declaration, so it works only because of evaluation order.
- Files: `pages/home.tsx:239` (`let signer = newSigner$.value;`) vs `:342` (`const newSigner$ = ...`).
- Trigger: Refactoring that moves `SetupComponent` below `HomeView` or calls it during module evaluation would crash with `ReferenceError: Cannot access 'newSigner$' before initialization`.
- Workaround: Move `const newSigner$ = new BehaviorSubject(...)` above `SetupComponent`.

### `giftWraps$` uses `skip(1)` assuming exactly one historical event

- Symptoms: New NIP-17 messages may be dropped or stale ones processed depending on how many events the relay returns on first emit.
- Files: `services/nostr.ts:213-236` — subscription uses `limit: 1` then `skip(1)` to "only get new ones".
- Trigger: If the relay returns zero events on first sync, the next real message becomes the "first" and is skipped. If it returns >1 (despite `limit:1`), behavior is also undefined.
- Workaround: None. The `limit: 1` is documented as a workaround for "random timestamps on gift wraps" but the `skip(1)` is fragile.
- Fix approach: Track the latest seen `created_at` per relay and filter with `since:` on resubscribe, or use a `ReplaySubject(1)` and only emit events whose `created_at` exceeds a high-water mark.

### `mailboxes$` / `messageInboxes$` silently complete after 10s timeout

- Symptoms: If mailboxes or DM-relay list can't be loaded within 10 seconds, `simpleTimeout(10_000)` completes the observable. All downstream notification subscriptions (`tagged$`, `giftWraps$`, `groups$`, relay auth) silently stop. No user-facing error.
- Files: `services/nostr.ts:86-97` (`mailboxes$`), `:100-119` (`messageInboxes$`).
- Trigger: Slow relay, network issue, or unresponsive `lookupRelays` on startup.
- Workaround: Restart the process.
- Fix approach: Replace `simpleTimeout` with a retry/reconnect strategy, and surface the failure through `log()` and the `/status` page.

### `tagged$` uses `since: unixNow() - 1` depending on local clock

- Symptoms: Clock skew on the host causes missed events (clock ahead) or duplicate processing of recent events (clock behind).
- Files: `services/nostr.ts:189-210`.
- Trigger: Any host clock drift relative to relays.
- Fix approach: Persist a high-water mark of the max `created_at` seen and use it as `since:` on reconnect.

## Security Considerations

### No authentication on any HTTP route (Critical)

- Risk: `serve()` in `index.ts:16-36` binds to `0.0.0.0:8080` (default) with no auth middleware. Every route — `/config` (GET reads pubkey, ntfy topic, email; PATCH overwrites them), `/signer` (GET reveals signer pubkey; POST connects a NIP-46 signer; DELETE disconnects), `/messages`/`/replies`/`/zaps`/`/groups` (PATCH modifies whitelists/blacklists) — is open to anyone who can reach the port.
- Files: `index.ts:16-36` (no auth), `pages/config.tsx`, `pages/signer.tsx`, `pages/messages.tsx`, `pages/replies.tsx`, `pages/zaps.tsx`, `pages/groups.tsx`.
- Current mitigation: None. The Dockerfile (`Dockerfile:11-17`) does not bind to localhost. Deployment behind a reverse proxy with auth is the user's responsibility, but undocumented.
- Recommendations:
  1. Add a shared `requireAuth` middleware that validates a bearer token or session cookie set on first-run setup.
  2. Bind to `127.0.0.1` by default; document the reverse-proxy requirement for remote access.
  3. At minimum, gate all mutating routes (`PATCH`/`POST`/`DELETE`) behind auth.

### No CSRF protection on mutating routes

- Risk: All `PATCH`/`POST`/`DELETE` handlers read form state via `ServerSentEventGenerator.readSignals(req)` with no origin check, no SameSite cookie, no CSRF token. A malicious page visited by an operator could submit `@patch('/config')` to redirect notifications to an attacker-controlled pubkey/ntfy topic.
- Files: `pages/config.tsx:172-231`, `pages/signer.tsx:254-379`, `pages/messages.tsx:122-178`, `pages/replies.tsx:88-141`, `pages/zaps.tsx:89-141`, `pages/groups.tsx:124-178`, `pages/home.tsx:391-463`.
- Current mitigation: None.
- Recommendations: Check `Origin` / `Sec-Fetch-Site` headers on mutating requests; reject cross-origin. Issue and verify CSRF tokens once auth exists.

### No TLS — secrets traverse the network in cleartext

- Risk: `Bun.serve()` is started without `tls` config (`index.ts:16`). The signer connection URI (which contains `secret=...`), the ntfy topic, and (when `sendContent` is enabled) DM plaintext are all sent over HTTP.
- Files: `index.ts:16-36`.
- Current mitigation: None in code; relies on an external reverse proxy.
- Recommendations: Document a TLS-terminating reverse proxy as required, or accept `tls` config from env (`TLS_CERT` / `TLS_KEY`).

### `config.json` stores signer secrets at rest in plaintext

- Risk: `services/config.ts:108-110` writes the full config (including `signer: SerializedAccount<any, any>` from `applesauce-accounts`, which encodes the NIP-46 bunker connection) to `CONFIG_PATH` as unencrypted JSON. Anyone with read access to the file owns the signer.
- Files: `services/config.ts:54-114`.
- Current mitigation: `/config.json` is gitignored (`.gitignore:37`). The Docker volume (`Dockerfile:9-11`) is plain filesystem.
- Recommendations: Encrypt the `signer` field with a passphrase supplied via env, or store it outside `config.json` in a secret manager. At minimum, set file mode `0600`.

### External QR-code service receives the Nostr Connect URI (secret leak)

- Risk: `pages/signer.tsx:36` and `pages/home.tsx:259` build the QR image via `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(signer.getNostrConnectURI())}`. The Nostr Connect URI includes the `secret=...` query parameter used to authenticate the bunker session. Sending it to a third-party service leaks that secret.
- Files: `pages/signer.tsx:33-36`, `pages/home.tsx:255-259`, `pages/mobile.tsx:14` (ntfy link only — lower severity).
- Current mitigation: None.
- Recommendations: Render QR codes client-side (e.g. with a vendored `qrcode` library) so the URI never leaves the browser. The Datastar script is already loaded from a CDN; a small QR lib can be vendored into `public/`.

### Unencrypted DM content sent to a third-party ntfy server

- Risk: When `messages.sendContent === true`, `notifications/messages.ts:147,202` passes the decrypted DM plaintext as the ntfy `message` body. ntfy servers (default `https://ntfy.sh`, see `services/ntfy.ts:134`) receive and store the plaintext.
- Files: `notifications/messages.ts:145-149,200-204`, `services/ntfy.ts:129-230`.
- Current mitigation: UI warning at `pages/messages.tsx:74-84`. Default config sets `sendContent: false` (`services/config.ts:62`).
- Recommendations: The migration path at `services/config.ts:93-101` sets `sendContent = directMessageNotifications` (i.e. `true`) for users upgrading with DM notifications enabled. Flip the migration default to `false` and require explicit opt-in.

### ntfy topic is the sole notification-channel secret

- Risk: The ntfy topic functions as a password — anyone who knows it can subscribe to all of the user's notifications (including DM content if `sendContent` is on). `nanoid().toLowerCase()` generates the default (`services/config.ts:55`); predictable or reused topics compromise the channel.
- Files: `services/config.ts:54-55`, `services/ntfy.ts:135-144`, `pages/config.tsx:77-100`.
- Current mitigation: UI warning at `pages/config.tsx:82-90`.
- Recommendations: Default to a longer random topic; consider ntfy access tokens (`Authorization` header) instead of topic-as-secret.

### Datastar SDK loaded from CDN `@main` (unpinned, supply-chain risk)

- Risk: `components/Document.tsx:17-19` loads `https://cdn.jsdelivr.net/gh/starfederation/datastar@main/bundles/datastar.js`. The `@main` ref floats; a breaking commit or a compromised release changes client behavior or injects code into the operator's browser. CDN outage breaks all UI.
- Files: `components/Document.tsx:17-19`.
- Current mitigation: None.
- Recommendations: Pin to a specific version tag (e.g. `@v1.0.0`) and vendor the file into `public/` so the server is self-contained.

### Unvalidated user input in `lookupRelays`

- Risk: `pages/config.tsx:197-200` only filters relay strings by `.startsWith("wss://")`. No URL parsing, no length cap, no deduplication against the existing `DEFAULT_LOOKUP_RELAYS`. Malformed entries that pass the prefix check can reach `RelayPool`.
- Files: `pages/config.tsx:197-200`.
- Recommendations: Use `new URL(relay)` validation, cap the list length, and dedupe via `helpers/array.ts#unique`.

## Performance Bottlenecks

### `loadLists` re-fetches every NIP-51 list on every notification event

- Problem: `shouldNotify` in each notification module calls `loadLists(messages.blacklists)` and `loadLists(messages.whitelists)` per event. `helpers/lists.ts:13-53` performs `firstValueFrom` against `eventStore.replaceable(...)` for every coordinate, with a 2s timeout each, on every invocation. There is no memoization.
- Files: `notifications/messages.ts:49,55`, `notifications/replies.ts:33,39`, `notifications/zaps.ts:33,39`, `notifications/groups.ts:48,54`, `helpers/lists.ts:13-53`.
- Cause: Lists are not cached even though `whitelist$`/`blacklist$` already exist as `shareReplay(1)` observables in `services/nostr.ts:239-248` for the global lists — the per-section lists bypass that cache.
- Improvement path: Replace synchronous `loadLists(...)` calls with subscriptions to per-section `whitelist$`/`blacklist$` observables (cached via `shareReplay(1)`), and resolve pubkeys once per config change.

### No subscription cleanup on shutdown

- Problem: `index.ts:42-59` calls `server.stop()` only. The `RelayPool` (`services/nostr.ts:60`), the auth subscription (`:146-186`), `tagged$` (`:189-210`), `giftWraps$` (`:213-236`), and all `notifications/*` subscriptions are never torn down. Relays may see abandoned sockets.
- Files: `index.ts:42-59`, `services/nostr.ts:60-315`, `notifications/{replies,zaps,messages,groups}.ts`.
- Improvement path: Call `pool.disconnect()` (or iterate `pool.relays` calling `.close()`) inside `gracefulShutdown` before `process.exit(0)`.

### In-memory log buffer retained for process lifetime

- Problem: `services/logs.ts:1-10` keeps a `logs` array of up to 10,000 entries with `{message, details}`. Each `details` object can hold full events/errors. Never exposed via any route.
- Files: `services/logs.ts:1-10`.
- Improvement path: Either expose via a `/logs` JSON endpoint (gated behind auth) or cap memory by switching to a ring buffer of structured entries.

## Fragile Areas

### `services/nostr.ts` is a side-effecting singleton module

- Files: `services/nostr.ts:59-315`.
- Why fragile: Importing the module for any reason (including from a future test or a UI helper) instantiates a global `RelayPool`, wires `NostrConnectSigner.subscriptionMethod`/`publishMethod` to that pool, opens relay connections, and starts the auth/subscription pipelines. There is no `init()` function — side effects run on first import.
- Safe modification: Do not add new top-level subscriptions without considering they fire on every process start. To make testable, refactor to a factory: `createNostrServices(config$): { eventStore, pool, ... }` and have consumers inject.
- Test coverage: None.

### `notifications/*` modules run subscriptions at import time

- Files: `notifications/index.ts:1-5`, `notifications/replies.ts:57-108`, `notifications/zaps.ts:58-113`, `notifications/messages.ts:87-205`, `notifications/groups.ts:97-137`.
- Why fragile: `index.ts` does `import "./replies"` etc. purely for side effects. Each module subscribes to observables at module top level. Disabling a notification type at runtime only stops the `enabled$`-gated inner subscription; the outer pipeline remains alive.
- Safe modification: Wrap each module's subscription in an exported `start*Notifications()` function and call them from `index.ts` after config validation.
- Test coverage: None.

### `signer$` BehaviorSubject has no error path

- Files: `services/nostr.ts:122-143`.
- Why fragile: `signer$` starts as `null` and is only updated by `configValue("signer")`. If config load fails or the signer JSON is malformed, `signer$` stays `null` forever and DM decryption / relay auth silently no-op. The `catch` in `unlockHiddenMutes` (`:267-273`) and `giftWraps$` `catchError` (`notifications/messages.ts:166-174`) swallow errors.
- Safe modification: Add an explicit `signerError$` observable and surface it on `/status` and `/signer` pages.

### `helpers/observable.ts#getValue` mixes `defined()` with a timeout

- Files: `helpers/observable.ts:4-9`.
- Why fragile: `defined()` filters out `null`/`undefined`, then `simpleTimeout` fires. If the source never emits a non-null value within the timeout, the promise rejects with a `TimeoutError` — but callers like `notifications/messages.ts:113-115` use it on `eventStore.profile(sender)` which may legitimately never resolve for unknown pubkeys. The reject is unhandled inside `mergeMap` (relies on RxJS error propagation).
- Safe modification: Add a fallback `of(undefined)` at the timeout so callers receive `undefined` instead of an error, and handle it explicitly.

### String-replacement link builders

- Files: `helpers/link.ts:15-59`.
- Why fragile: `buildOpenLink` and `buildGroupLink` do raw `template.replace(...)` on user-controlled inputs (relay URLs from group tags, app-link template from config). No URL-encoding of substituted values. A relay URL containing `{id}` or `{link}` could produce malformed links; a malicious `appLink` template could inject attributes.
- Safe modification: URL-encode substituted values, or use a structured template engine.

## Scaling Limits

### Single-process, in-memory event store

- Current capacity: `EventStore` from `applesauce-core` is in-memory; capacity is bounded by host RAM. No persistence across restarts.
- Limit: A high-volume pubkey (many zaps/replies) will accumulate events until the process is restarted, then lose them all.
- Scaling path: Persist the EventStore to SQLite (applesauce supports this) or accept that restarts re-fetch from relays via the `since:` filter.

### One Nostr Connect signer session per process

- Current capacity: `signer$` holds a single `NostrConnectAccount`. `NostrConnectSigner.subscriptionMethod` / `publishMethod` are set as static fields on the class (`services/nostr.ts:66-67`), making the pool a process-wide singleton.
- Limit: Cannot serve multiple users per process.
- Scaling path: Multi-tenant support would require per-user `RelayPool` and `EventStore` instances plus a session map keyed by pubkey.

## Dependencies at Risk

### `@starfederation/datastar-sdk` and CDN `@main` bundle

- Risk: SDK is pinned to `^1.0.0` in `package.json:21`, but the client bundle loaded by the browser (`components/Document.tsx:18`) floats `@main`. Server SDK and client bundle can drift, causing SSE protocol mismatches (the `.cursor/rules/datastar.mdc` rule explicitly warns about "Version mismatch between client/SDK").
- Impact: Broken reactivity in the config UI.
- Migration plan: Pin the CDN URL to the exact installed version and vendor it.

### `applesauce-*` v6 suite (recently migrated)

- Risk: Per `CHANGELOG.md` 0.3.0, the v6 migration just happened. All `applesauce-*` packages are at `^6.0.x` / `^6.1.x` (`package.json:22-27`). API surface may still be shifting; `noUncheckedIndexedAccess` is on, so minor upstream type changes will fail `bun run lint` (`tsc --noEmit`).
- Impact: A `bun update` could break the build.
- Migration plan: Pin exact versions in `package.json` and run `bun run lint` on any upgrade before merging.

## Missing Critical Features

### No tests

- Problem: There are zero test files in the repository. `package.json:9-13` defines only `dev`, `lint` (which is `tsc --noEmit`), and `format` scripts — no `test`. The `.cursor/rules/datastar-testing.mdc` rule describes Playwright patterns but none are implemented.
- Blocks: Any refactor of `shouldNotify`, signer setup, or `services/nostr.ts` has no safety net. Cannot detect regressions in notification delivery.

### No structured logging or error tracking

- Problem: `services/logs.ts` is `console.log` plus an in-memory array. `index.ts:65-70` and several pages use raw `console.error`. No log levels, no structured output, no Sentry/Loki integration.
- Blocks: Diagnosing production issues; the only way to inspect logs is to read the `console` output.

### No rate limiting on outbound notifications

- Problem: Every event passing `shouldNotify` triggers a `sendNotification` (`notifications/*.ts`). A flood of replies or zaps produces a flood of ntfy POSTs with no deduplication, coalescing, or backoff.
- Blocks: Resilient operation against a noisy sender or a replay attack.

### No JSON health endpoint

- Problem: `/status` (`pages/status.tsx`) returns HTML only. There is no `/healthz` or `/api/status` for orchestrators (Docker `HEALTHCHECK`, Kubernetes liveness).
- Blocks: Container orchestration health probes.

## Test Coverage Gaps

### Entire codebase is untested

- What's not tested: All of `services/`, `notifications/`, `helpers/`, `pages/`, and `components/`.
- Files: every `.ts`/`.tsx` file in the repo.
- Risk: Any change to notification filtering, signer setup, config migration (`services/config.ts:93-101`), or link building can ship broken. The v6 applesauce migration (CHANGELOG 0.3.0) shipped with no regression tests.
- Priority: High — at minimum, add unit tests for `helpers/lists.ts#loadLists`, `helpers/link.ts#buildOpenLink`/`buildGroupLink`, and `services/config.ts` migration logic; plus a Playwright smoke test for the `/config` → save → reload flow per `.cursor/rules/datastar-testing.mdc`.

---

*Concerns audit: 2026-07-07*
