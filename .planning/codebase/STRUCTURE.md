# Codebase Structure

**Analysis Date:** 2026-07-07

## Directory Layout

```
nostr-secretary/
├── index.ts              # Process entry — Bun.serve route registry + signal handlers
├── const.ts              # App-wide constants (default relays, signer permissions, group link template)
├── config.json           # Persisted AppConfig (loaded at boot, written on every change)
├── package.json          # Bun project manifest, deps, scripts
├── tsconfig.json         # TS config — bundler mode, @kitajs/html JSX, strict
├── bun.lock              # Bun lockfile
├── Dockerfile            # oven/bun:1.2 image, /app/data volume, CONFIG env
├── .dockerignore
├── .gitignore
├── .prettierrc           # Prettier config
├── .mcp.json             # MCP server config
├── .vscode/              # Editor settings
├── .cursor/rules/        # Cursor AI rules
├── .github/workflows/    # CI (Docker build/publish)
├── README.md
├── CHANGELOG.md
├── CLAUDE.md -> AGENTS.md (symlink, target missing)
├── components/           # Reusable JSX HTML fragments
│   ├── Document.tsx
│   ├── Layout.tsx
│   └── WhitelistBlacklist.tsx
├── pages/                # HTTP route handlers — one file per URL
│   ├── home.tsx
│   ├── config.tsx
│   ├── status.tsx
│   ├── notifications.tsx
│   ├── messages.tsx
│   ├── replies.tsx
│   ├── zaps.tsx
│   ├── groups.tsx
│   ├── signer.tsx
│   └── mobile.tsx
├── services/             # Singletons and stateful clients
│   ├── config.ts
│   ├── nostr.ts
│   ├── ntfy.ts
│   └── logs.ts
├── notifications/        # Background RxJS listeners (self-subscribe on import)
│   ├── index.ts
│   ├── replies.ts
│   ├── zaps.ts
│   ├── messages.ts
│   └── groups.ts
├── helpers/              # Pure-ish utility functions
│   ├── link.ts
│   ├── lists.ts
│   ├── observable.ts
│   ├── array.ts
│   └── groups.ts
├── public/               # Static CSS served at root
│   ├── layout.css
│   ├── form.css
│   └── button.css
└── .planning/            # GSD planning artifacts (not part of runtime)
    └── codebase/
```

## Directory Purposes

**`pages/`:**
- Purpose: One file per HTTP route; each default-exports a `route` object keyed by HTTP method
- Contains: `.tsx` files with a `*View()` JSX function and a `const route = { GET, PATCH, POST, DELETE }` default export
- Key files: `home.tsx` (setup wizard + status), `config.tsx` (general config form), `signer.tsx` (NIP-46 connect/disconnect), `status.tsx` (relay dashboard), `messages.tsx`/`replies.tsx`/`zaps.tsx`/`groups.tsx` (per-type config forms)

**`services/`:**
- Purpose: Process-wide singletons, stateful clients, and the config store
- Contains: `.ts` files exporting module-level instances and helper functions
- Key files: `nostr.ts` (`EventStore`, `RelayPool`, `signer$`, `tagged$`, `giftWraps$`, `mailboxes$`, `isMuted`), `config.ts` (`config$`, `configValue`, `updateConfig`, `getConfig`, `AppConfig` type), `ntfy.ts` (`sendNotification`, `NtfyPriority`, `NtfyServiceError`), `logs.ts` (`log`, `logs` array)

**`notifications/`:**
- Purpose: Long-lived background RxJS subscriptions that turn Nostr events into ntfy pushes
- Contains: `.ts` files that self-subscribe on import and export an `enabled$` observable
- Key files: `index.ts` (side-effect aggregator imported once by `index.ts`), `replies.ts`, `zaps.ts`, `messages.ts`, `groups.ts`

**`helpers/`:**
- Purpose: Stateless utility functions shared across layers
- Contains: `.ts` files with pure functions (one has a module-level cache Map)
- Key files: `link.ts` (`buildOpenLink`, `buildGroupLink`), `lists.ts` (`loadLists` — resolves NIP-51 list coordinates to pubkeys), `observable.ts` (`getValue` — `firstValueFrom` + `defined` + timeout wrapper), `groups.ts` (`getGroupMetadata` with in-memory cache), `array.ts` (`unique`)

**`components/`:**
- Purpose: Reusable JSX fragments rendered into HTML strings via `@kitajs/html`
- Contains: `.tsx` files exporting default async/sync component functions
- Key files: `Document.tsx` (HTML shell, stylesheet links, Datastar CDN script), `Layout.tsx` (page chrome — title + subtitle + content wrapper), `WhitelistBlacklist.tsx` (async form fragment that reads `lists$` to populate follow-set dropdown)

**`public/`:**
- Purpose: Static CSS files served directly by Bun
- Contains: `layout.css`, `form.css`, `button.css` — referenced by `components/Document.tsx` and mapped in `index.ts:32-34`

## Key File Locations

**Entry Points:**
- `index.ts`: Process bootstrap, route registry, graceful shutdown
- `notifications/index.ts`: Side-effect import that boots all background listeners

**Configuration:**
- `config.json`: Persisted app state (loaded at boot, auto-rewritten on every change via `services/config.ts:108-110`)
- `tsconfig.json`: TS strict mode, `@kitajs/html` JSX, bundler module resolution, `allowImportingTsExtensions`, `noEmit`
- `package.json`: Bun scripts (`dev`, `lint`, `format`), dependency manifest
- `Dockerfile`: Production image — `oven/bun:1.2`, `/app/data` volume, `CONFIG=/app/data/config.json`, `PORT=8080`
- `.prettierrc`: Prettier formatting config
- `const.ts`: Compile-time constants — `DEFAULT_LOOKUP_RELAYS`, `DEFAULT_SIGNER_RELAY`, `CACHI_GROUP_LINK`, `SIGNER_PERMISSIONS`

**Core Logic:**
- `services/nostr.ts`: All Nostr integration — EventStore, RelayPool, event/lists loaders, shared observables, relay AUTH orchestration, mute-list resolution
- `services/config.ts`: `AppConfig` type definition, `BehaviorSubject` store, JSON persistence, `configValue`/`updateConfig`/`getConfig` API
- `services/ntfy.ts`: ntfy HTTP client — `sendNotification`, `sendSimpleNotification`, `sendUrgentNotification`, `NtfyPriority` enum, `NtfyServiceError`
- `notifications/*.ts`: Per-type event filtering, parent/profile lookup, `shouldNotify` gate, `sendNotification` call

**Testing:**
- Not present — no test files, no test runner, no test config anywhere in the repo

## Naming Conventions

**Files:**
- `camelCase.ts` / `camelCase.tsx` for all source files: `index.ts`, `const.ts`, `services/nostr.ts`, `pages/config.tsx`, `helpers/observable.ts`
- One file per route in `pages/`, named after the URL path segment: `/signer` → `signer.tsx`, `/messages` → `messages.tsx`
- One file per notification type in `notifications/`, named after the type: `replies.ts`, `zaps.ts`, `messages.ts`, `groups.ts`
- View components in `components/` use `PascalCase.tsx`: `Document.tsx`, `Layout.tsx`, `WhitelistBlacklist.tsx`

**Directories:**
- Lowercase plural for collections: `pages/`, `services/`, `notifications/`, `helpers/`, `components/`
- No nested subdirectories within source layers (flat layout)

**Exports:**
- Pages: `export function <Name>View()` (PascalCase + `View` suffix) + `const route = {...}; export default route`
- Components: `export default function <Name>(props)` (PascalCase)
- Services: named exports for singletons (`config$`, `eventStore`, `pool`, `signer$`) and functions (`configValue`, `updateConfig`, `sendNotification`, `log`); `config.ts` also has `export default config$`
- Helpers: named function exports (`buildOpenLink`, `loadLists`, `getValue`, `unique`)
- Notification listeners: `export const enabled$` + self-subscribe side effect; no default export

**Observables:**
- Trailing `$` suffix: `config$`, `signer$`, `tagged$`, `giftWraps$`, `mailboxes$`, `messageInboxes$`, `whitelist$`, `blacklist$`, `mutedPubkeys$`, `groups$`, `lists$`, `user$`, `enabled$`, `newSigner$`

**Types:**
- `PascalCase` for types/interfaces: `AppConfig`, `NtfyNotificationOptions`, `NtfyAction`, `NtfyResponse`, `NtfyError`, `WhitelistBlacklistProps`, `DocumentProps`, `LayoutProps`
- `Ntfy` prefix for ntfy-domain types: `NtfyPriority`, `NtfyServiceError`

## Where to Add New Code

**New HTTP route (e.g. `/foo`):**
1. Create `pages/foo.tsx` with `export function FooView()` and `const route = { GET, ... }; export default route`
2. Import and register in `index.ts`: `import fooRoute from "./pages/foo";` then add `"/foo": fooRoute,` to the `routes` object in `index.ts:18-29`
3. Use `components/Document.tsx` as the HTML shell and `components/Layout.tsx` for page chrome
4. If the page needs form mutations, add `PATCH`/`POST`/`DELETE` handlers returning `ServerSentEventGenerator.stream(...)`; use `ServerSentEventGenerator.readSignals(req)` to parse Datastar signals
5. Add new static CSS files to `public/` and register them both in `components/Document.tsx` `<link>` tags and in the `index.ts` static-file route map

**New notification type (e.g. `reactions`):**
1. Create `notifications/reactions.ts` — import `tagged$` (or build a new subscription in `services/nostr.ts`), filter by kind, define local `shouldNotify` (currently copy from an existing listener), call `sendNotification`
2. Export `enabled$` observable derived from `config$` slice
3. Add side-effect import in `notifications/index.ts`: `import "./reactions";`
4. Add a config slice to `AppConfig` in `services/config.ts` (with `enabled`, `whitelists`, `blacklists`) and a default in the initial `BehaviorSubject` value
5. Create `pages/reactions.tsx` config page and register in `index.ts`
6. Add a card to `pages/notifications.tsx` `NotificationsList` reading `reactionsNotification.enabled$`

**New shared Nostr observable:**
- Add to `services/nostr.ts` — export as named const with trailing `$`; use `share()`/`shareReplay(1)`/`shareAndHold()` to multicast
- If it needs a new relay subscription, use `pool.subscription(...)` with `{ reconnect: Infinity, resubscribe: true }` for long-lived streams

**New utility function:**
- Add to `helpers/<topic>.ts` (create the file if needed); keep functions pure and stateless
- If a cache is needed, follow the `helpers/groups.ts` pattern (module-level `Map`)

**New reusable UI fragment:**
- Add `components/<Name>.tsx` with `export default function <Name>(props)` returning JSX
- Async components are supported (used for `WhitelistBlacklist.tsx` which `await`s `lists$`)

**New static asset:**
- Place in `public/`; register in `components/Document.tsx` `<link>`/`<script>` tags AND in the static-file route map in `index.ts:32-34`

**New constant:**
- Add to `const.ts` and import where needed

**Tests:**
- No test infrastructure exists. If adding tests, introduce a runner (Bun's built-in `bun test` is the natural fit) and a `test/` or co-located `*.test.ts` convention; consult CONVENTIONS.md / TESTING.md (to be authored) before committing to a pattern.

## Special Directories

**`.planning/`:**
- Purpose: GSD workflow artifacts (this file, phase plans, etc.)
- Generated: Yes (by GSD tooling)
- Committed: Yes (per GSD convention)
- Not part of runtime — not referenced by any source file

**`public/`:**
- Purpose: Static CSS files served at fixed root URLs
- Generated: No
- Committed: Yes
- Served via explicit route entries in `index.ts:32-34`

**`node_modules/`:**
- Purpose: Bun-installed dependencies
- Generated: Yes (by `bun install`)
- Committed: No (in `.gitignore`)

**`.github/workflows/`:**
- Purpose: CI pipelines (Docker image build & publish to `ghcr.io/hzrd149/nostr-secretary`)
- Generated: No
- Committed: Yes

**`.cursor/rules/` and `.vscode/`:**
- Purpose: Editor/AI assistant configuration
- Generated: No
- Committed: Yes

---

*Structure analysis: 2026-07-07*
