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

// Read config file if set from env
if (await fs.exists(CONFIG_PATH)) {
  const parsed = JSON.parse(await fs.readFile(CONFIG_PATH, "utf-8"));

  // Migrate old directMessageNotifications field to new messages structure
  if (parsed.directMessageNotifications !== undefined && !parsed.messages) {
    parsed.messages = {
      enabled: parsed.directMessageNotifications,
      sendContent: parsed.directMessageNotifications, // Default to same value
      whitelists: [],
      blacklists: [],
    };
    delete parsed.directMessageNotifications;
  }

  // Backfill groups.modes for configs written before per-group modes shipped
  // (D-10, Pitfall 1). Guards against the documented legacy shape (key
  // absent) as well as other invalid persisted shapes -- `null` (valid JSON,
  // plausible from a hand-edited config.json) or any non-object value --
  // since getGroupMode/passesGroupModeGate/MODE_BADGE all assume an object
  // to index into (WR-02).
  if (
    parsed.groups &&
    (parsed.groups.modes == null || typeof parsed.groups.modes !== "object")
  ) {
    parsed.groups.modes = {};
  }

  config$.next({ ...config$.value, ...parsed });
  loaded = true;
}

// Save config when it changes
config$.pipe(skip(1)).subscribe((config) => {
  fs.writeFile(CONFIG_PATH, JSON.stringify(config, null, 2));
});

// If no config file, create one
if (!loaded)
  await fs.writeFile(CONFIG_PATH, JSON.stringify(config$.getValue(), null, 2));

/** Create an observable that gets a config value */
export function configValue<K extends keyof AppConfig>(
  key: K,
): Observable<AppConfig[K]> {
  return config$.pipe(map((c) => c[key]));
}

/** Sets a config value */
export function updateConfig(update: Partial<AppConfig>) {
  config$.next({ ...config$.value, ...update });
}

export function getConfig() {
  return config$.getValue();
}

export default config$;
