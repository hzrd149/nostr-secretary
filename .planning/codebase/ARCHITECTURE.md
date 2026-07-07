<!-- refreshed: 2026-07-07 -->
# Architecture

**Analysis Date:** 2026-07-07

## System Overview

```text
┌─────────────────────────────────────────────────────────────┐
│                  HTTP Entry Point (`index.ts`)               │
│   Bun.serve routes — pages/ + static CSS from public/        │
├──────────────────┬──────────────────┬───────────────────────┤
│   pages/*.tsx    │   pages/*.tsx    │    pages/*.tsx         │
│  Server-rendered │  Datastar SSE    │    Status dashboard    │
│  HTML via        │  PATCH/POST/     │    (read-only GET)     │
│  @kitajs/html    │  DELETE handlers │                       │
└────────┬─────────┴────────┬─────────┴──────────┬────────────┘
         │                  │                     │
         ▼                  ▼                     ▼
┌─────────────────────────────────────────────────────────────┐
│           Cross-Cutting Services (`services/`)               │
│  config$  •  nostr (EventStore + RelayPool)  •  ntfy  • logs │
└────────┬─────────────────────────────────────────────────────┘
         │  (shared observables imported by both layers)
         ▼
┌─────────────────────────────────────────────────────────────┐
│        Background Notification Listeners (`notifications/`)  │
│  replies  •  zaps  •  messages  •  groups                   │
│  RxJS subscriptions over tagged$ / giftWraps$ / pool         │
└────────┬─────────────────────────────────────────────────────┘
         │  sendNotification()
         ▼
┌─────────────────────────────────────────────────────────────┐
│   ntfy HTTP push  →  user mobile (ntfy app / email)          │
└─────────────────────────────────────────────────────────────┘
```

## Component Responsibilities

| Component | Responsibility | File |
|-----------|----------------|------|
| HTTP bootstrap | Starts Bun server, registers routes, graceful shutdown | `index.ts` |
| Routes registry | Maps URL paths to page route handlers | `index.ts` |
| Notification boot | Side-effect import that wires all listeners | `notifications/index.ts` |
| Config state | Single `BehaviorSubject<AppConfig>` persisted to JSON | `services/config.ts` |
| Nostr core | EventStore, RelayPool, loaders, shared observables | `services/nostr.ts` |
| ntfy client | Builds HTTP POST with headers, sends to ntfy server | `services/ntfy.ts` |
| Log buffer | In-memory ring buffer (max 10k) + console mirror | `services/logs.ts` |
| Replies listener | Filters kind 1 events tagging user, fetches parent, notifies | `notifications/replies.ts` |
| Zaps listener | Filters kind 9735 zap events, validates recipient, notifies | `notifications/zaps.ts` |
| Messages listener | Unlocks NIP-04 + NIP-17 gift wraps, notifies | `notifications/messages.ts` |
| Groups listener | Subscribes to NIP-29 group message relays, notifies | `notifications/groups.ts` |
| Layout/Document | HTML shell + Datastar script tag, page chrome | `components/Document.tsx`, `components/Layout.tsx` |
| WhitelistBlacklist | Reusable form fragment for NIP-51 list config | `components/WhitelistBlacklist.tsx` |
| Link builder | Encodes nevent/naddr/npub into app link template | `helpers/link.ts` |
| Lists loader | Resolves NIP-51 list coordinates → pubkey arrays | `helpers/lists.ts` |
| Group metadata | Cached per-group kind 39000 fetch | `helpers/groups.ts` |
| Observable util | `getValue()` helper wrapping `firstValueFrom` + `defined()` + timeout | `helpers/observable.ts` |

## Pattern Overview

**Overall:** Reactive single-process service — RxJS observables as the shared nervous system, side-effect subscriptions as background workers, server-rendered HTML for the admin UI.

**Key Characteristics:**
- One in-memory `EventStore` (from `applesauce-core`) is the single source of truth for Nostr events. All notification listeners read from it; loaders populate it via `mapEventsToStore`.
- One `RelayPool` instance (`applesauce-relay`) is module-level singleton in `services/nostr.ts`, shared by HTTP handlers and notification subscribers.
- One `BehaviorSubject<AppConfig>` (`services/config.ts`) holds all app state; mutations persist to disk; consumers derive slices via `configValue(key)`.
- HTML pages use `@kitajs/html` JSX (no React runtime) — server renders strings; Datastar SDK wires interactivity via SSE.
- Background listeners self-subscribe on import (`notifications/*.ts`); `notifications/index.ts` is imported once in `index.ts` purely for side effects.

## Layers

**HTTP / Page Layer:**
- Purpose: Render admin UI, accept form mutations, stream SSE patches
- Location: `pages/*.tsx`
- Contains: One default export `route` object per file with `GET`/`PATCH`/`POST`/`DELETE` methods; view functions returning JSX strings
- Depends on: `components/`, `services/config`, `services/nostr`, `services/logs`, `helpers/`, `notifications/*` (only to read exported `enabled$` observables for status display)
- Used by: `index.ts` route registry

**Service Layer:**
- Purpose: Singletons and stateful clients shared app-wide
- Location: `services/`
- Contains: `config.ts` (state + persistence), `nostr.ts` (EventStore, RelayPool, observables), `ntfy.ts` (HTTP client), `logs.ts` (log buffer)
- Depends on: `applesauce-*`, `nostr-tools`, `rxjs`, `nanoid`, `const.ts`, `helpers/lists`
- Used by: pages, notifications

**Notification Listener Layer:**
- Purpose: Long-lived RxJS subscriptions that filter incoming events and push notifications via ntfy
- Location: `notifications/`
- Contains: One module per notification type; each exports `enabled$` observable and self-subscribes on import; each defines its own local `shouldNotify(pubkey)` predicate
- Depends on: `services/nostr`, `services/config`, `services/ntfy`, `services/logs`, `helpers/link`, `helpers/lists`
- Used by: `notifications/index.ts` (side-effect aggregator), `pages/notifications.tsx` + `pages/home.tsx` (read `enabled$`)

**Helper Layer:**
- Purpose: Pure-ish utility functions with no module-level state except `helpers/groups.ts` cache
- Location: `helpers/`
- Contains: `link.ts`, `lists.ts`, `observable.ts`, `array.ts`, `groups.ts`
- Depends on: `applesauce-*`, `nostr-tools`, `rxjs`, `services/nostr`, `services/config`, `const.ts`
- Used by: pages, notifications, services

**Presentation Component Layer:**
- Purpose: Reusable JSX fragments rendered into HTML strings
- Location: `components/`
- Contains: `Document.tsx` (HTML shell + stylesheet links + Datastar CDN script), `Layout.tsx` (page chrome), `WhitelistBlacklist.tsx` (async form fragment reading `lists$`)
- Depends on: `applesauce-core/helpers`, `nostr-tools`, `rxjs`, `services/nostr`
- Used by: pages

## Data Flow

### Primary Request Path — Incoming Nostr Event → Push Notification

1. `RelayPool` opens subscriptions to user's inbox relays (`services/nostr.ts:188-210` `tagged$`, `:212-236` `giftWraps$`)
2. Incoming events are filtered (`#p` tag matches user pubkey) and written to `eventStore` via `mapEventsToStore`
3. Notification listener subscribes to `tagged$` (or `giftWraps$`), filters by kind, e.g. `notifications/replies.ts:58-64` filters `kind === 1`
4. Listener fetches referenced parent/profile events from `eventStore` (which lazily triggers `eventLoader` to fetch from relays)
5. `shouldNotify(pubkey)` checks NIP-51 mute list (`isMuted`), per-type whitelist/blacklist, and global whitelist/blacklist
6. `sendNotification()` (`services/ntfy.ts:129`) POSTs to `{server}/{topic}` with `X-Title`, `X-Click`, `X-Icon` headers
7. ntfy server fans out to mobile app subscribers and/or email fallback

### Secondary Flow — Admin Form Save (Datastar SSE)

1. Browser renders server HTML (e.g. `pages/config.tsx` `GET`) with `data-on-click="@patch(location.href)"` attributes
2. Datastar client serializes bound signals and POSTs to the same URL
3. Route `PATCH` handler calls `ServerSentEventGenerator.readSignals(req)` → mutates `config$.next({...})`
4. `config$` `skip(1)` subscription persists to `config.json` (`services/config.ts:108-110`)
5. Handler streams `stream.patchSignals({ saved: true })` or `stream.patchElements(...)` back to browser
6. Datastar merges the SSE patch into the live DOM

### Secondary Flow — Signer Connect (NIP-46)

1. `pages/signer.tsx` `GET` creates `NostrConnectSigner` connected to `DEFAULT_SIGNER_RELAY` (`wss://relay.nsec.app`), stores in module-level `newSigner$` `BehaviorSubject`
2. Page renders QR code with `signer.getNostrConnectURI()`
3. `data-on-load="@post(location.href)"` triggers `POST` handler, which `await`s `signer.waitForSigner()`
4. On connect, `NostrConnectAccount` is created, `signer$.next(account)` updates the shared account observable, `updateConfig({ signer })` persists
5. `services/nostr.ts:146-186` `combineLatest([signer$, mailboxes$, messageInboxes$])` subscriber kicks off relay AUTH (NIP-42) flow on each relay that requires it

**State Management:**
- App config: single `BehaviorSubject<AppConfig>` in `services/config.ts`, mutated via `config$.next({...current, ...patch})` or `updateConfig()`, auto-persisted to `config.json` (path overridable via `Bun.env.CONFIG`)
- Nostr events: single `EventStore` from `applesauce-core` in `services/nostr.ts:59`
- Signer: `BehaviorSubject<NostrConnectAccount | null>` in `services/nostr.ts:122`, hydrated from config on boot
- Pending QR signer: module-level `BehaviorSubject` in `pages/home.tsx:342` and `pages/signer.tsx:13` (separate per page)
- Logs: in-memory array capped at 10k in `services/logs.ts`

## Key Abstractions

**Route Handler Object:**
- Purpose: Uniform HTTP method → handler mapping consumed by `Bun.serve.routes`
- Examples: `pages/config.tsx`, `pages/signer.tsx`, `pages/home.tsx`
- Pattern: `const route = { GET, PATCH, POST, DELETE }; export default route;` — GET returns full HTML `Response`, mutating methods return `ServerSentEventGenerator.stream(...)` for Datastar patches

**Shared Nostr Observables:**
- Purpose: Single subscription fan-out for common event streams
- Examples: `tagged$`, `giftWraps$`, `mailboxes$`, `messageInboxes$`, `whitelist$`, `blacklist$`, `mutedPubkeys$`, `groups$`, `lists$` in `services/nostr.ts`
- Pattern: Built with `combineLatest` + `switchMap` + `share()` / `shareReplay(1)` / `shareAndHold(timeout)`; consumers `firstValueFrom()` for one-shot reads or subscribe for streams

**`shouldNotify(pubkey)` Predicate:**
- Purpose: Per-notification-type gate combining mute list + per-type lists + global lists
- Examples: duplicated in `notifications/replies.ts:25`, `notifications/zaps.ts:26`, `notifications/messages.ts:41`, `notifications/groups.ts:40`
- Pattern: `await isMuted(pubkey)` → check type-specific `blacklists` → check type-specific `whitelists` → fall back to global `whitelist$` / `blacklist$`

**`configValue(key)` Selector:**
- Purpose: Typed observable slice of config
- Location: `services/config.ts:117-121`
- Pattern: `config$.pipe(map((c) => c[key]))` — used by `services/nostr.ts` to derive `user$`, lookup relays, signer config

## Entry Points

**`index.ts` (process entry):**
- Location: `index.ts`
- Triggers: `bun run index.ts` (or Docker `ENTRYPOINT`)
- Responsibilities: Imports `notifications/` for side effects, calls `Bun.serve` with route table, wires `SIGTERM`/`SIGINT` graceful shutdown, `unhandledRejection` / `uncaughtException` loggers

**`notifications/index.ts` (listener boot):**
- Location: `notifications/index.ts`
- Triggers: Side-effect import in `index.ts:14`
- Responsibilities: Imports `replies`, `zaps`, `messages`, `groups` — each module self-subscribes on import

**HTTP routes:**
- `/` → `pages/home.tsx` (setup wizard + status summary)
- `/config` → `pages/config.tsx` (general config)
- `/status` → `pages/status.tsx` (relay connection dashboard)
- `/notifications` → `pages/notifications.tsx` (notification type overview)
- `/messages`, `/replies`, `/zaps`, `/groups` → per-type config pages
- `/signer` → `pages/signer.tsx` (NIP-46 signer connect/disconnect)
- `/mobile` → `pages/mobile.tsx` (ntfy mobile setup QR)
- `/layout.css`, `/form.css`, `/button.css` → static files from `public/`

## Architectural Constraints

- **Single-threaded event loop:** Bun runs the whole app in one process; all relay subscriptions, HTTP handlers, and the EventStore share one thread. CPU-bound work would block SSE streams.
- **Global state singletons (module-level):** `eventStore`, `pool`, `signer$`, `config$` in `services/nostr.ts` and `services/config.ts`; `newSigner$` in `pages/home.tsx` and `pages/signer.tsx`; `cache` Map in `helpers/groups.ts`; `logs` array in `services/logs.ts`. No DI container — every consumer imports the singleton directly.
- **Cold-start config load is async top-level await:** `services/config.ts:89` uses top-level `await fs.exists(...)` — the module won't finish evaluating (and won't export observables) until disk read completes. Any importer blocks on this.
- **No tests present:** No test files, runner config, or fixtures exist anywhere in the repo. Verification is manual.
- **Notification listeners never tear down:** Subscriptions in `notifications/*.ts` are created at import time and live for the process lifetime; `enabled$` switches between `tagged$` and `NEVER` to gate work but underlying pool subscriptions persist.
- **`shouldNotify` duplicated 4×:** Identical logic copy-pasted per notification type with only the config slice swapped. Drift risk.
- **`appLink` template substitution:** `helpers/link.ts:15-26` does string `.replace()` for `{link}`, `{nevent}`, `{naddr}`, `{pubkey}`, `{npub}`. New placeholders require editing this single function.
- **HTML is server-rendered to string:** `@kitajs/html` JSX compiles to string templates, not React vnodes. Components are async functions returning strings; `await` is used to resolve observables during render. There is no client hydration — only Datastar SSE patches.

## Anti-Patterns

### Duplicated `shouldNotify` across notification types

**What happens:** `notifications/replies.ts:25-53`, `notifications/zaps.ts:26-54`, `notifications/messages.ts:41-69`, `notifications/groups.ts:40-68` each define their own `async function shouldNotify(pubkey)` with byte-identical bodies except the destructured config key (`replies` / `zaps` / `messages` / `groups`).
**Why it's wrong:** Any change to mute-list precedence, whitelist fallback, or list-loading timeout must be applied in four places. Bugs silently diverge between notification types.
**Do this instead:** Extract a single factory in `helpers/` that takes the per-type config slice, e.g. `makeShouldNotify(configSlice)` returning the predicate. Import in each listener.

### Module-level `BehaviorSubject` for pending signer state

**What happens:** `pages/home.tsx:342` and `pages/signer.tsx:13` each declare `const newSigner$ = new BehaviorSubject<NostrConnectSigner | null>(null)`. Both pages independently create a `NostrConnectSigner` on `GET` and stash it in their own subject.
**Why it's wrong:** If a user loads `/signer` then navigates to `/`, the signer created on `/signer` is abandoned and a new one is created on `/`. Pending NIP-46 sessions are lost on navigation. Two pending signers can race for the same bunker relay connection.
**Do this instead:** Hoist `newSigner$` into `services/nostr.ts` (or a dedicated `services/signer.ts`) so pending-signer state is process-global and survives page navigation.

### Inline `<style>` blocks per page

**What happens:** `pages/home.tsx:16-112`, `pages/status.tsx:7-156`, `pages/notifications.tsx:9-154` each embed multi-kilobyte CSS template strings inside the view function. The same `.status-item` / `.status-value` rules are redefined in `home.tsx` and `status.tsx`.
**Why it's wrong:** CSS duplication, larger HTML payloads, no caching of these styles, drift between pages that style the same components.
**Do this instead:** Move shared status styles to `public/layout.css` or a dedicated `public/status.css` served as a static file; keep page-specific overrides inline only when truly unique.

## Error Handling

**Strategy:** Localized try/catch with logging; notifications swallow errors and log rather than throw; HTTP routes catch and surface errors via Datastar `patchSignals({ error })`.

**Patterns:**
- `sendNotification` (`services/ntfy.ts:191-229`) wraps `fetch` in try/catch and rethrows as typed `NtfyServiceError` with `code` / `httpStatus` — callers in `notifications/*` do NOT catch, so a failed push rejects the subscriber callback and is logged by RxJS.
- `notifications/messages.ts:166-174` uses `catchError` inside `mergeMap` to convert gift-wrap unlock failures into `EMPTY`, preventing one bad event from killing the subscription.
- `services/nostr.ts:265-273` catches hidden-mute unlock failure and logs, returning public mutes only.
- HTTP handlers (`pages/config.tsx:220-229`, `pages/signer.tsx:286-294`) wrap mutations in try/catch and emit `stream.patchSignals(JSON.stringify({ error: message }))` for Datastar to display.
- `pages/home.tsx:65-70` registers process-level `unhandledRejection` / `uncaughtException` loggers — no restart, just log.
- `helpers/lists.ts:26-38` uses `Promise.allSettled` + per-request `timeout({ first: 2000 })` so one unresponsive list coordinate doesn't block the rest.
- `isMuted` (`services/nostr.ts:286-294`) falls back to an empty `Set` after 2s timeout so notification flow never blocks indefinitely on the mute list.

## Cross-Cutting Concerns

**Logging:** Custom `log(message, details?)` in `services/logs.ts` — `console.log` + push to in-memory `logs` array capped at 10,000 entries (oldest shifted). No structured logging, no levels, no transport. Logs are not exposed via any HTTP route.

**Validation:** Pubkey validation via `normalizeToPubkey()` from `applesauce-core/helpers` in `pages/config.tsx:190` and `pages/home.tsx:402`. Relay URLs filtered to `wss://`-prefixed in `pages/config.tsx:200`. ntfy topic validated with HTML `pattern="[a-zA-Z0-9_-]+"` attribute only (no server-side enforcement). No general schema validation layer.

**Authentication:** None on the HTTP admin UI — anyone who can reach port 8080 can read/modify config. Nostr-side auth (NIP-42) is handled automatically by `services/nostr.ts:146-186` using the connected signer when relays require it. The signer itself is a NIP-46 `NostrConnectAccount` stored as `SerializedAccount` JSON in `config.json`.

---

*Architecture analysis: 2026-07-07*
