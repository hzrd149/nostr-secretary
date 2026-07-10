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
 * Applies three migrations:
 * 1. Reshapes the old `directMessageNotifications` boolean field into the
 *    `messages` object. `messages.sendContent` is forced to `false`
 *    unconditionally (D3-04) -- an upgrading user must never be silently
 *    opted into forwarding decrypted DM plaintext to the ntfy server, even
 *    if they previously had DM notifications enabled.
 * 2. Splits the flat `messages.enabled` field into per-category
 *    `messages.contacts.enabled` / `messages.others.enabled`, seeding BOTH
 *    from the pre-existing value so upgraders see no behavior change (D5-06).
 *    Runs whether `messages.enabled` came from this migration's own
 *    `directMessageNotifications` reshape above, or was already present from
 *    a Phase-3/4-era config.json. Guarded on both `contacts` AND `others`
 *    being absent, so a config already on the new shape is left untouched
 *    (idempotent) and no `messages.enabled` key is ever re-introduced.
 * 3. Backfills `groups.modes` for configs written before per-group modes
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

  // D5-06: split the flat messages.enabled into per-category contacts/others
  // flags, seeding BOTH from the legacy value. The guard (both keys absent)
  // makes this idempotent -- a config already carrying contacts/others is
  // skipped, and messages.enabled is never re-added.
  if (
    parsed.messages &&
    typeof parsed.messages === "object" &&
    parsed.messages.contacts === undefined &&
    parsed.messages.others === undefined
  ) {
    const legacyEnabled = parsed.messages.enabled === true;
    parsed.messages.contacts = { enabled: legacyEnabled };
    parsed.messages.others = { enabled: legacyEnabled };
    delete parsed.messages.enabled;
  }

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
