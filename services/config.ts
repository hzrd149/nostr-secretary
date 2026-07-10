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
    enabled: boolean;
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

const config$ = new BehaviorSubject<AppConfig>({
  topic: nanoid().toLowerCase(),
  lookupRelays: DEFAULT_LOOKUP_RELAYS,
  appLink: "nostr:{link}",
  whitelists: [],
  blacklists: [],
  messages: {
    enabled: false,
    sendContent: false,
    whitelists: [],
    blacklists: [],
  },
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
 * Applies two migrations:
 * 1. Reshapes the old `directMessageNotifications` boolean field into the
 *    `messages` object. `messages.sendContent` is forced to `false`
 *    unconditionally (D3-04) -- an upgrading user must never be silently
 *    opted into forwarding decrypted DM plaintext to the ntfy server, even
 *    if they previously had DM notifications enabled.
 * 2. Backfills `groups.modes` for configs written before per-group modes
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

  // Backfill groups.modes for configs written before per-group modes shipped
  // (D-10, Pitfall 1).
  if (
    parsed.groups &&
    (parsed.groups.modes == null || typeof parsed.groups.modes !== "object")
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
