# Coding Conventions

**Analysis Date:** 2026-07-07

## Naming Patterns

**Files:**
- All lowercase, single word or compound. No separators: `config.ts`, `nostr.ts`, `ntfy.ts`, `logs.ts`, `link.ts`, `lists.ts`, `groups.ts`, `array.ts`, `observable.ts`, `Document.tsx`, `Layout.tsx`, `WhitelistBlacklist.tsx`
- `.ts` for services/helpers/notifications/const; `.tsx` for pages and components (JSX returns required)
- Page files match the URL path: route `/zaps` → `pages/zaps.tsx`; route `/groups` → `pages/groups.tsx`
- One default export per file for the primary subject (component, route, or default observable); named exports for utilities and types

**Functions:**
- camelCase for functions and async helpers: `sendNotification`, `loadLists`, `buildOpenLink`, `buildGroupLink`, `getGroupMetadata`, `shouldNotify`, `configValue`, `updateConfig`, `getConfig`, `getValue`, `unique`, `gracefulShutdown`
- PascalCase for React/component functions: `HomeView`, `ConfigView`, `StatusView`, `NotificationsView`, `SetupComponent`, `RelayStatusItem`, `ConnectionStatus`, `Document`, `Layout`, `WhitelistBlacklist`
- Private/internal helpers (not exported) live above the export they support, e.g. `addCommonTags` in `helpers/link.ts`, `shareAndHold` in `services/nostr.ts`, `subscribeToGroup` in `notifications/groups.ts`

**Variables:**
- camelCase for locals and module functions: `currentConfig`, `messageInboxes`, `connectedRelays`, `totalRelays`
- Trailing `$` suffix for RxJS Observables (project-wide convention): `config$`, `user$`, `mailboxes$`, `messageInboxes$`, `signer$`, `tagged$`, `giftWraps$`, `whitelist$`, `blacklist$`, `mutedPubkeys$`, `groups$`, `lists$`, `enabled$`, `newSigner$`, `eventLoader`, `listsLoader` (loaders are exceptions, no `$`)
- UPPER_SNAKE_CASE for module constants: `DEFAULT_LOOKUP_RELAYS`, `DEFAULT_SIGNER_RELAY`, `CACHI_GROUP_LINK`, `SIGNER_PERMISSIONS`, `CONFIG_PATH`

**Types:**
- PascalCase for types and interfaces: `AppConfig`, `NtfyAction`, `NtfyNotificationOptions`, `NtfyResponse`, `NtfyError`, `NtfyServiceError`, `DocumentProps`, `LayoutProps`, `WhitelistBlacklistProps`
- Use `export type` for type-only exports and `export interface` for object shapes (see `services/ntfy.ts`, `services/config.ts`)
- Props interfaces are co-located in the component file and named `<Component>Props` (e.g. `WhitelistBlacklistProps` in `components/WhitelistBlacklist.tsx`)

## Code Style

**Formatting:**
- Prettier with config in `.prettierrc`: `tabWidth: 2`, `useTabs: false`
- 2-space indentation, double quotes for strings, semicolons required, trailing commas
- Run via `bun run format` (script: `prettier --write .`)

**Linting:**
- No ESLint/Biome config. Type checking is the primary static analysis gate
- `bun run lint` runs `tsc --noEmit` against `tsconfig.json`
- `tsconfig.json` enables: `strict`, `noFallthroughCasesInSwitch`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`, `moduleResolution: "bundler"`, `allowImportingTsExtensions`, `noEmit: true`
- `noUnusedLocals` and `noUnusedParameters` are explicitly disabled (allows intentional non-use, e.g. `replies.ts:78` checks `if (!parent)` after `defined()`)

**JSX/TSX:**
- `jsx: "react-jsx"` with `jsxImportSource: "@kitajs/html"` — Kita HTML produces stringified HTML server-side, not React runtime
- `types: ["@kitajs/html/all-types.d.ts"]` is loaded globally for JSX intrinsic element typing
- Components are async functions returning `Promise<string>`; rendered with `await` inside parent JSX
- Use `safe` attribute on elements with user-supplied text content to escape HTML: `<h1 safe>{title}</h1>` (`components/Layout.tsx:11-12`), `<textarea ... safe>` (`components/WhitelistBlacklist.tsx:43`)
- `class` attribute (not `className`) — Kita HTML emits real HTML

## Import Organization

**Order (observed consistently across files):**
1. External SDK/framework imports (`@starfederation/datastar-sdk/web`, `applesauce-*`, `nostr-tools`, `rxjs`, `nanoid`, `bun`, `fs/promises`)
2. Internal absolute-relative imports from `../const`, `../services/*`, `../helpers/*`, `../components/*`, `../notifications/*`
3. Side-effect imports last: `import "./notifications"` (`index.ts:14`), `import "./replies"` (`notifications/index.ts:2`)

**Sub-import paths:**
- Prefer deep imports for tree-shaking and clarity: `applesauce-core/helpers`, `applesauce-common/helpers`, `applesauce-loaders/loaders`, `applesauce-accounts/accounts`, `nostr-tools/nip19`, `nostr-tools/kinds`
- `rxjs` imports are named, often large lists grouped together (see `services/nostr.ts:28-47`)

**Path Aliases:**
- None. All internal imports use relative paths (`../services/config`, `../helpers/lists`)

**Type-only imports:**
- `verbatimModuleSyntax: true` requires `import type { ... }` for types. Observed in `services/config.ts:1` (`import type { SerializedAccount }`), `helpers/groups.ts:7` (`import type { NostrEvent }`), `helpers/lists.ts:8` (`import type { AddressPointer }`)

## Error Handling

**Patterns:**
- **Custom error classes** for domain errors: `NtfyServiceError extends Error` in `services/ntfy.ts:115` with `code`, `httpStatus` fields and `name` set in constructor
- **Re-throw after wrapping**: `services/ntfy.ts:222-229` catches errors, re-throws as `NtfyServiceError` if not already one
- **try/catch in route handlers** with `stream.patchSignals(JSON.stringify({ error: ... }))` to surface errors to the Datastar client — see `pages/home.tsx:414-423`, `pages/config.tsx:220-229`
- **Error instanceof Error** narrowing for safe `.message` access: `error instanceof Error ? error.message : "An unknown error occurred"` (`pages/config.tsx:223-226`)
- **RxJS `catchError` returning `EMPTY`** to silently swallow stream errors: `notifications/messages.ts:166-174`, `notifications/groups.ts:87-94`
- **RxJS `timeout` with fallback observable** instead of throwing: `timeout({ first: 2000, with: () => of(undefined) })` — see `helpers/lists.ts:15`, `helpers/groups.ts:21`, `services/nostr.ts:290`
- **`.catch(() => false)` on `firstValueFrom`** for optional UI state: `pages/notifications.tsx:158-165`
- **Process-level handlers** for uncaught errors in `index.ts:65-70`: `unhandledRejection` and `uncaughtException` log via `console.error` but do not exit

**Anti-pattern observed:**
- `Reflect.get(error as object, "message")` used to extract messages from unknown error shapes (`services/nostr.ts:271`, `notifications/messages.ts:170`) — fragile and bypasses type narrowing. Prefer `error instanceof Error ? error.message : String(error)`

## Logging

**Framework:** Custom lightweight logger in `services/logs.ts`

**API:**
- `log(message: string, details?: Record<string, any>): void`
- Logs to `console.log` AND appends to an in-memory ring buffer `logs` (capped at 10,000 entries, pruned via `logs.shift()`)
- The `logs` array is exported and consumed by the status endpoint for in-process log viewing

**Patterns:**
- Always import `{ log } from "../services/logs"` — never call `console.log` directly in services/notifications. (Routes/pages occasionally use `console.error` for render-time errors, e.g. `pages/status.tsx:323`)
- Pass structured `details` object as second arg: `log("Sending ntfy notification", { topic, server, options })` (`services/ntfy.ts:192`)
- Use past-tense or present-continuous message strings: `"Listening for replies"`, `"Restoring signer"`, `"Authenticated to relay"`, `"Failed to unlock gift wrap"`
- Log at decision points: skipped notifications, connection state, signer lifecycle

## Comments

**When to Comment:**
- JSDoc `/** ... */` on every exported function, type, interface, and observable in `services/` and `helpers/` — describes purpose, not implementation. Examples: `services/config.ts:117`, `services/nostr.ts:82-85`, `services/ntfy.ts:5-14`, `helpers/lists.ts:12`, `helpers/observable.ts:4`
- Inline `//` comments explain non-obvious RxJS operators or NIP references: `// Only request once` (`services/nostr.ts:91`), `// Skip the first event since we only want new ones` (`services/nostr.ts:232`), `// NIP-17 gift wraps` (`services/nostr.ts:225`)
- NIP references inline: `// Never notify for pubkeys the user has muted (NIP-51 kind 10000)` (`notifications/replies.ts:28`)
- `// Ingore events from the user themselves` — typos in comments are tolerated; do not gate on comment spelling

**JSDoc/TSDoc:**
- Single-line `/** ... */` for short descriptions
- Multi-line with `@param`-style field docs for interfaces: `NtfyNotificationOptions` (`services/ntfy.ts:42-74`) documents each field with `/** ... */` above the property
- No `@returns` / `@param` tags used — descriptions are prose only

## Function Design

**Size:** Files stay focused and small (median ~130 lines). Largest source file is `pages/status.tsx` at 502 lines, then `pages/home.tsx` at 466. No file-length rule enforced.

**Parameters:**
- Object-parameter pattern for public APIs with many options: `sendNotification(options: NtfyNotificationOptions)` (`services/ntfy.ts:129`)
- Positional params acceptable for 1-2 arg helpers: `getValue(observable, timeout=5_000)`, `isMuted(pubkey)`, `loadLists(lists)`
- Route handlers receive `req: BunRequest` for methods needing body parsing; `GET` handlers take no args

**Return Values:**
- Services return `Promise<T>` (async) or `Observable<T>` (reactive)
- RxJS pipelines end with `.pipe(share())` or `.pipe(shareReplay(1))` to make cold observables shareable across subscribers — `services/nostr.ts:209`, `services/nostr.ts:241-247`
- Custom `shareAndHold(timeout)` operator (`services/nostr.ts:52-57`) wraps `share()` with a `ReplaySubject(1)` connector and `timer(timeout)` reset — use this for "cache value for N seconds" semantics

**Async in components:**
- Page/component functions can be `async` and `await` observables via `firstValueFrom` to render server-side. See `pages/home.tsx:114` (`async function RelayStatusItem()`), `pages/notifications.tsx:156` (`async function NotificationOverview()`)
- Always provide a fallback for timed-out observable awaits in components (try/catch returning a default JSX node) — `pages/home.tsx:152-159`

## Module Design

**Exports:**
- Default export for the primary module subject:
  - Pages: `const route = { GET, PATCH, POST }; export default route;` — route object with HTTP method handlers
  - Services: `export default config$` (`services/config.ts:132`) alongside named exports
  - Components: `export default function Document(...)` (`components/Document.tsx`)
- Named exports for everything else: utilities, types, observables, constants
- Side-effect modules (`notifications/*`) export an `enabled$` observable for status checks and otherwise subscribe at import time

**Barrel Files:**
- `notifications/index.ts` is the only barrel — imports all notification modules for their side effects. `index.ts:14` does `import "./notifications"` to start all listeners
- No barrel files in `services/`, `helpers/`, `components/`, or `pages/` — import directly from the specific file

**Singletons at module scope:**
- `eventStore`, `pool`, `eventLoader`, `listsLoader`, `signer$`, `config$` are module-level singletons in `services/nostr.ts` and `services/config.ts`. Importing these files shares the single instance process-wide — this is intentional
- `newSigner$` in `pages/home.tsx:342` is a module-level `BehaviorSubject` — page-scoped mutable state persisted across requests within the same process

---

*Convention analysis: 2026-07-07*
