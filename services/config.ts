import type { SerializedAccount } from "applesauce-accounts";
import fs from "fs/promises";
import { nanoid } from "nanoid";
import { BehaviorSubject, map, Observable, skip } from "rxjs";
import { CACHI_GROUP_LINK, DEFAULT_LOOKUP_RELAYS } from "../const";
import type { GroupNotificationMode } from "../helpers/groups";

export type AppConfig = {
  /** The hex pubkey of the user */
  pubkey?: string;
  /** An array of relays to use when looking up profiles and mailboxes */
  lookupRelays: string[];
  /** The ntfy server to use */
  server?: string;
  /** The ntfy topic to send notifications to */
  topic?: string;
  /** A fallback email for notifications */
  email?: string;
  /** App link template for notification clicks. {link} will be replaced with NIP-19 encoded nevent/naddr */
  appLink?: string;
  /** A signer for the user */
  signer?: SerializedAccount<any, any>;
  /** Global whitelist/blacklist for notifications */
  whitelists: string[];
  /** Global blacklist for notifications */
  blacklists: string[];
  /** Direct message notifications */
  messages: {
    /** Notifications for DMs from senders on the user's kind-3 follow list (D5-01/D5-04) */
    contacts: { enabled: boolean };
    /** Notifications for DMs from senders NOT on the user's kind-3 follow list (D5-04) */
    others: { enabled: boolean };
    sendContent: boolean;
    whitelists: string[];
    blacklists: string[];
  };
  /** Replies notifications */
  replies: {
    enabled: boolean;
    whitelists: string[];
    blacklists: string[];
  };
  /** Zaps notifications */
  zaps: {
    enabled: boolean;
    whitelists: string[];
    blacklists: string[];
  };
  /** Groups notifications */
  groups: {
    enabled: boolean;
    whitelists: string[];
    blacklists: string[];
    groupLink: string;
    /** Per-group notification mode, keyed by encodeGroupPointer(group).
     *  Groups with no entry fall back to DEFAULT_GROUP_NOTIFICATION_MODE (D-06/D-10). */
    modes: Record<string, GroupNotificationMode>;
  };
};

/**
 * The D5-05 (corrected) new-install default for `messages`: notify for DMs
 * from followed senders (contacts) but NOT from strangers (others) until the
 * user explicitly opts in -- a conservative, anti-spam default distinct from
 * the pre-Phase-5 seed (`messages.enabled: false`, i.e. no DM notifications
 * at all). Existing users are unaffected -- `migrateConfig`'s D5-06 step
 * seeds both flags from their current `messages.enabled` value instead.
 * Exported so tests (and any future gate) can assert against this default
 * directly rather than duplicating its shape.
 */
export const DEFAULT_MESSAGES_CONFIG: AppConfig["messages"] = {
  contacts: { enabled: true },
  others: { enabled: false },
  sendContent: false,
  whitelists: [],
  blacklists: [],
};

const config$ = new BehaviorSubject<AppConfig>({
  topic: nanoid().toLowerCase(),
  lookupRelays: DEFAULT_LOOKUP_RELAYS,
  appLink: "nostr:{link}",
  whitelists: [],
  blacklists: [],
  messages: DEFAULT_MESSAGES_CONFIG,
  replies: {
    enabled: true,
    whitelists: [],
    blacklists: [],
  },
  zaps: {
    enabled: true,
    whitelists: [],
    blacklists: [],
  },
  groups: {
    enabled: true,
    whitelists: [],
    blacklists: [],
    groupLink: CACHI_GROUP_LINK,
    modes: {},
  },
});

const CONFIG_PATH = Bun.env.CONFIG ?? "config.json";

let loaded = false;
let configWrite = Promise.resolve();

function writeConfig(config: AppConfig) {
  configWrite = configWrite
    .catch(() => {})
    .then(() => fs.writeFile(CONFIG_PATH, JSON.stringify(config, null, 2)));

  configWrite.catch((error) => {
    console.error("Failed to write config", error);
  });

  return configWrite;
}

/**
 * One-time legacy-config migration, applied to a freshly-parsed config.json
 * before it is merged into config$. Pure function of its input -- no I/O, no
 * config$ access -- so it is unit-testable in isolation (D3-09).
 *
 * Applies four migrations:
 * 1. Reshapes the old `directMessageNotifications` boolean field into the
 *    `messages` object. `messages.sendContent` is forced to `false`
 *    unconditionally (D3-04) -- an upgrading user must never be silently
 *    opted into forwarding decrypted DM plaintext to the ntfy server, even
 *    if they previously had DM notifications enabled.
 * 2. Normalizes a null/non-object top-level `messages` (e.g. a hand-edited
 *    `"messages": null`) to a fresh copy of DEFAULT_MESSAGES_CONFIG *before*
 *    the split below runs, mirroring the `groups` guard in migration 4 --
 *    otherwise `config$.next({ ...config$.value, ...parsed })` would
 *    overwrite the default `messages` object with `null` and every
 *    downstream `config.messages.contacts/others` read would throw (CR-01).
 * 3. Splits the flat `messages.enabled` field into per-category
 *    `messages.contacts.enabled` / `messages.others.enabled`. Each missing
 *    key is backfilled independently -- a partial new-schema config with
 *    only ONE category key present (e.g. a hand-edit or interrupted write)
 *    must not skip the other key (CR-01). When a legacy `messages.enabled`
 *    flag is present, BOTH missing keys inherit its value so upgraders see
 *    no behavior change (D5-06); otherwise (no legacy flag -- a genuinely
 *    partial new-schema config) each missing key falls back to its own
 *    D5-05 default (contacts:true / others:false) instead of assuming
 *    legacy semantics. Also backfills `whitelists`/`blacklists` (to `[]`)
 *    and `sendContent` (to `false`) if missing, so a partial legacy shape
 *    (e.g. `{ messages: { enabled: true } }` with no lists) can't crash
 *    `shouldNotify()`'s `.length` checks (CR-01). Idempotent -- a config
 *    already on the new shape with both keys present, and with lists/
 *    sendContent already set, is left untouched, and `messages.enabled` is
 *    never re-added.
 * 4. Backfills `groups.modes` for configs written before per-group modes
 *    shipped (Phase 1 D-10, Pitfall 1). Guards against the documented legacy
 *    shape (key absent) as well as other invalid persisted shapes -- `null`
 *    (valid JSON, plausible from a hand-edited config.json) or any
 *    non-object value -- since getGroupMode/passesGroupModeGate/MODE_BADGE
 *    all assume an object to index into (WR-02).
 */
export function migrateConfig(parsed: any): any {
  // Migrate old directMessageNotifications field to new messages structure
  if (parsed.directMessageNotifications !== undefined && !parsed.messages) {
    parsed.messages = {
      enabled: parsed.directMessageNotifications,
      sendContent: false, // D3-04: never inherit the legacy value -- explicit opt-in only
      whitelists: [],
      blacklists: [],
    };
    delete parsed.directMessageNotifications;
  }

  // Normalize a null/non-object top-level `messages` first (mirrors the
  // groups guard below), so a corrupted/hand-edited config.json can't crash
  // every downstream consumer of messages.contacts/others (CR-01).
  if (parsed.messages == null || typeof parsed.messages !== "object") {
    parsed.messages = structuredClone(DEFAULT_MESSAGES_CONFIG);
  }

  // D5-06: split the flat messages.enabled into per-category contacts/others
  // flags, backfilling each missing key independently (CR-01) -- never
  // require BOTH keys to be absent before backfilling either one. If a
  // legacy `messages.enabled` flag is present, seed any missing key from it
  // so upgraders see no behavior change; otherwise fall back to that key's
  // own D5-05 default.
  if (
    parsed.messages.contacts === undefined ||
    parsed.messages.others === undefined
  ) {
    const hasLegacyFlag = parsed.messages.enabled !== undefined;
    const legacyEnabled = parsed.messages.enabled === true;

    if (parsed.messages.contacts === undefined)
      parsed.messages.contacts = {
        enabled: hasLegacyFlag
          ? legacyEnabled
          : DEFAULT_MESSAGES_CONFIG.contacts.enabled,
      };
    if (parsed.messages.others === undefined)
      parsed.messages.others = {
        enabled: hasLegacyFlag
          ? legacyEnabled
          : DEFAULT_MESSAGES_CONFIG.others.enabled,
      };
  }
  delete parsed.messages.enabled;

  // Backfill any still-missing scalar/array fields (CR-01) so a partial
  // legacy shape (e.g. `{ messages: { enabled: true } }` with no
  // whitelists/blacklists) can't crash shouldNotify()'s `.length` checks.
  if (!Array.isArray(parsed.messages.whitelists))
    parsed.messages.whitelists = [];
  if (!Array.isArray(parsed.messages.blacklists))
    parsed.messages.blacklists = [];
  if (typeof parsed.messages.sendContent !== "boolean")
    parsed.messages.sendContent = false;

  // Backfill groups.modes for configs written before per-group modes shipped
  // (D-10, Pitfall 1). Normalize a null/non-object top-level `groups` first
  // (e.g. a hand-edited `"groups": null`) so the modes backfill below can't
  // be bypassed and leave `groups` itself null (WR-03).
  if (parsed.groups == null || typeof parsed.groups !== "object") {
    parsed.groups = {};
  }
  if (
    parsed.groups.modes == null ||
    typeof parsed.groups.modes !== "object"
  ) {
    parsed.groups.modes = {};
  }

  return parsed;
}

// Read config file if set from env
if (await fs.exists(CONFIG_PATH)) {
  const parsed = migrateConfig(
    JSON.parse(await fs.readFile(CONFIG_PATH, "utf-8")),
  );

  config$.next({ ...config$.value, ...parsed });
  loaded = true;
}

// Save config when it changes
config$.pipe(skip(1)).subscribe((config) => {
  writeConfig(config);
});

// If no config file, create one
if (!loaded)
  await writeConfig(config$.getValue());

/** Create an observable that gets a config value */
export function configValue<K extends keyof AppConfig>(
  key: K,
): Observable<AppConfig[K]> {
  return config$.pipe(map((c) => c[key]));
}

/** Sets a config value */
export function updateConfig(update: Partial<AppConfig>) {
  config$.next({ ...config$.value, ...update });
  return configWrite;
}

export function getConfig() {
  return config$.getValue();
}

export default config$;
