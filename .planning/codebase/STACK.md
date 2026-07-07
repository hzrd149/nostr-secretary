# Technology Stack

**Analysis Date:** 2026-07-07

## Languages

**Primary:**
- TypeScript (ESNext target, strict mode) — All application code (`index.ts`, `services/*.ts`, `notifications/*.ts`, `pages/*.tsx`, `helpers/*.ts`, `components/*.tsx`)
- JSX/TSX via `@kitajs/html` — Server-rendered HTML templates (`pages/*.tsx`, `components/*.tsx`)

**Secondary:**
- CSS — Static stylesheets served as static files (`public/layout.css`, `public/form.css`, `public/button.css`)
- YAML — GitHub Actions workflow (`.github/workflows/docker.yml`)
- Dockerfile — Container build definition (`Dockerfile`)
- JSON — App config (`config.json`), MCP config (`.mcp.json`), prettier config (`.prettierrc`)

## Runtime

**Environment:**
- Bun 1.2 (based on `Dockerfile` `FROM oven/bun:1.2`) — Primary runtime and HTTP server via `Bun.serve`
- TypeScript 5.9 (`typescript@^5.9.3` devDependency) — Type checking only (`tsc --noEmit`); no compile step, Bun executes TS directly

**Package Manager:**
- Bun — Lockfile: `bun.lock` (present)
- Node.js compatibility: ESM modules (`"type": "module"`), `moduleResolution: bundler`

## Frameworks

**Core:**
- Bun built-in HTTP server — `serve()` from `bun` used in `index.ts:16` to serve route handlers and static CSS files
- Applesauce SDK (v6.x) — Reactive Nostr SDK built on RxJS, the primary application framework for all Nostr interactions
  - `applesauce-core@^6.1.0` — EventStore, `mapEventsToStore`, `defined`, helpers (`services/nostr.ts`)
  - `applesauce-relay@^6.0.3` — `RelayPool`, `onlyEvents` (`services/nostr.ts`)
  - `applesauce-loaders@^6.1.0` — `createEventLoaderForStore`, `createUserListsLoader` (`services/nostr.ts`)
  - `applesauce-accounts@^6.0.0` — `NostrConnectAccount` (`services/nostr.ts`, `pages/signer.tsx`)
  - `applesauce-signers@^6.0.1` — `NostrConnectSigner` (`const.ts`, `services/nostr.ts`, `pages/signer.tsx`)
  - `applesauce-common@^6.1.0` — Helpers for gift wraps, mutes, zaps, messages, groups
- RxJS 7.8 (`rxjs@^7.8.2`) — Reactive programming backbone; `BehaviorSubject`, `combineLatest`, `switchMap`, `shareReplay` used throughout `services/nostr.ts` and `notifications/*.ts`
- Datastar SDK (`@starfederation/datastar-sdk@^1.0.0`) — Server-Sent Events based reactivity for the web UI; `ServerSentEventGenerator` used in `pages/signer.tsx`, `pages/config.tsx`
- @kitajs/html 4.2 (`@kitajs/html@^4.2.13`) — JSX-to-HTML string rendering for server-side templates (tsconfig `jsx: react-jsx`, `jsxImportSource: @kitajs/html`)

**Testing:**
- None detected — No test framework, no test files, no test scripts in `package.json`

**Build/Dev:**
- Bun — Dev server with watch mode: `bun run --watch index.ts` (script `dev`)
- `tsc --noEmit` — Type checking only (script `lint`)
- Prettier 3.8 (`prettier@^3.8.3`) — Code formatting (script `format`, config `.prettierrc`: 2-space indent, no tabs)
- Docker Buildx — Multi-platform image build (`linux/amd64,linux/arm64`) via GitHub Actions

## Key Dependencies

**Critical:**
- `nostr-tools@^2.23.5` — Nostr primitives: `kinds` enum used everywhere for event kind constants (`const.ts`, `services/nostr.ts`, all `notifications/*.ts`)
- `applesauce-core@^6.1.0` — Central `EventStore` (in-memory event store, singleton in `services/nostr.ts:59`); the reactive data hub all notifications read from
- `applesauce-relay@^6.0.3` — `RelayPool` singleton (`services/nostr.ts:60`) managing all relay connections, subscriptions, and authentication
- `applesauce-signers@^6.0.1` — NIP-46 (Nostr Connect) signer for remote signing; used to decrypt DMs and authenticate to relays
- `rxjs@^7.8.2` — Underpins all reactive flows; the entire notification pipeline is RxJS observables

**Infrastructure:**
- `nanoid@^5.1.11` — Generates random default ntfy topic on first run (`services/config.ts:55`)
- `@kitajs/html@^4.2.13` — JSX template rendering for all pages
- `@starfederation/datastar-sdk@^1.0.0` — SSE streaming for interactive UI updates (signer connect, config edits)

## Configuration

**Environment:**
- `PORT` — HTTP server port (default `8080`, read in `index.ts:17`, set in `Dockerfile:12`)
- `CONFIG` — Path to config JSON file (default `config.json`, overridden to `/app/data/config.json` in `Dockerfile:11`); read via `Bun.env.CONFIG` in `services/config.ts:84`
- `NODE_ENV` — Set to `production` in `Dockerfile:4`
- No `.env` file present (gitignored, not created in repo)

**Build:**
- `tsconfig.json` — Strict TS config, `target: ESNext`, `module: ESNext`, `moduleResolution: bundler`, `verbatimModuleSyntax`, `noEmit`, `noUncheckedIndexedAccess`, JSX configured for `@kitajs/html`
- `.prettierrc` — 2-space indentation, spaces not tabs
- `Dockerfile` — Single-stage build from `oven/bun:1.2`, copies app, runs `bun install --frozen-lockfile --production`, exposes port 8080, volume at `/app/data` for config persistence
- `.dockerignore` — Present
- `.mcp.json` — MCP server config (nostr MCP via npx `@nostrbook/mcp@latest`, applesauce MCP via HTTP `https://mcp.applesauce.build/mcp`) — development tooling only, not used at runtime

**Runtime config file (`config.json`):**
- Shape defined by `AppConfig` type in `services/config.ts:7-52`
- Loaded at startup from `Bun.env.CONFIG ?? "config.json"` (`services/config.ts:84-105`)
- Auto-saved on every change via RxJS subscription (`services/config.ts:108-110`)
- Created with defaults if missing (`services/config.ts:113-114`)
- Migration logic for old `directMessageNotifications` field to new `messages` structure (`services/config.ts:93-101`)
- Key fields: `pubkey`, `lookupRelays`, `server` (ntfy), `topic` (ntfy), `email`, `appLink`, `signer` (serialized NIP-46 account), per-category `whitelists`/`blacklists`, `messages`/`replies`/`zaps`/`groups` toggle blocks

## Platform Requirements

**Development:**
- Bun 1.2+ installed
- TypeScript 5.9+ (installed as devDependency)
- No native dependencies detected (pure TS/JS)

**Production:**
- Docker container `oven/bun:1.2` — published to `ghcr.io/<owner>/nostr-secretary` via GitHub Actions
- Multi-platform: `linux/amd64` and `linux/arm64`
- Persistent volume required at `/app/data` for config.json across container restarts
- Network egress required: WebSocket to Nostr relays, HTTPS to ntfy server, HTTPS to QR code API
- Listens on port 8080 (configurable via `PORT` env var)

---

*Stack analysis: 2026-07-07*
