import { DEFAULT_RATE_LIMIT_CONFIG, type AppConfig } from "../services/config";
import { isGroupNotificationMode, type GroupNotificationMode } from "./groups";

/**
 * The NIP-78 application-data kind (APP_DATA_KIND) used to store synced
 * notification preferences (D2-01). Supersedes the ROADMAP phase title's
 * literal "1xxxx" wording -- 30078 is the standard, library-supported,
 * parameterized-replaceable app-data kind.
 */
export const PREFS_KIND = 30078;

/**
 * Stable `d`-tag identifier that namespaces this app's notification-prefs
 * event from any other kind-30078 app-data an interoperating client might
 * store for the same pubkey (D2-01).
 */
export const PREFS_NAMESPACE = "nostr-secretary/notification-prefs";

/**
 * Forward-compatible schema marker included in every synced payload (D2-06).
 * Bumped to 2 for the D5-10 messages.contacts/messages.others split --
 * `sanitizeSyncedPrefs`'s `asMessagesCategories` fallback (below) uses the
 * absence of `contacts`/`others` keys (not this version number directly) to
 * detect a not-yet-upgraded peer's old-schema payload, so the bump itself is
 * a forward-compatibility marker for future schema changes rather than the
 * mechanism this particular fallback keys off of (Pitfall 5).
 * Bumped to 3 for the D6-07 rateLimit addition -- like the D5-10 bump,
 * `sanitizeSyncedPrefs`'s rateLimit fallback (below) keys off the absence of
 * the `rateLimit` key itself, not this version number, so the bump is again
 * a forward-compatibility marker rather than the fallback's detection
 * mechanism.
 */
export const PREFS_VERSION = 3;

/**
 * The rules-only subset of `AppConfig` that is serialized, NIP-44
 * self-encrypted, and published as the kind-30078 app-data event (D2-04).
 * Deliberately excludes device-local secrets/config -- pubkey, signer,
 * server, topic, email, lookupRelays, messages.sendContent, and
 * groups.groupLink never appear here (D2-05/Pitfall 8).
 */
export type SyncedPrefs = {
  version: number;
  messages: {
    contacts: { enabled: boolean };
    others: { enabled: boolean };
    whitelists: string[];
    blacklists: string[];
  };
  replies: { enabled: boolean; whitelists: string[]; blacklists: string[] };
  zaps: { enabled: boolean; whitelists: string[]; blacklists: string[] };
  groups: {
    enabled: boolean;
    whitelists: string[];
    blacklists: string[];
    modes: Record<string, GroupNotificationMode>;
  };
  whitelists: string[];
  blacklists: string[];
  appLink?: string;
  rateLimit: {
    window: number;
    global: number;
    perType: {
      replies: number;
      zaps: number;
      messages: number;
      groups: number;
    };
  };
};

/**
 * Extracts the D2-04 rules-only subset of `config` into a plain-JSON
 * `SyncedPrefs` object, ready to be `JSON.stringify`'d and NIP-44 encrypted.
 * Builds the object field-by-field (never spreads a whole sub-object) so
 * `messages.sendContent` and `groups.groupLink` can never leak into the
 * synced payload (Pitfall 8), and never reads pubkey/signer/server/topic/
 * email/lookupRelays (D2-05).
 */
export function serializePrefs(config: AppConfig): SyncedPrefs {
  return {
    version: PREFS_VERSION,
    messages: {
      contacts: { enabled: config.messages.contacts.enabled },
      others: { enabled: config.messages.others.enabled },
      whitelists: config.messages.whitelists,
      blacklists: config.messages.blacklists,
    },
    replies: {
      enabled: config.replies.enabled,
      whitelists: config.replies.whitelists,
      blacklists: config.replies.blacklists,
    },
    zaps: {
      enabled: config.zaps.enabled,
      whitelists: config.zaps.whitelists,
      blacklists: config.zaps.blacklists,
    },
    groups: {
      enabled: config.groups.enabled,
      whitelists: config.groups.whitelists,
      blacklists: config.groups.blacklists,
      modes: config.groups.modes,
    },
    whitelists: config.whitelists,
    blacklists: config.blacklists,
    appLink: config.appLink,
    rateLimit: {
      window: config.rateLimit.window,
      global: config.rateLimit.global,
      perType: {
        replies: config.rateLimit.perType.replies,
        zaps: config.rateLimit.perType.zaps,
        messages: config.rateLimit.perType.messages,
        groups: config.rateLimit.perType.groups,
      },
    },
  };
}

/** Coerces an unknown value into a string[], dropping any non-string entries (ASVS V5). */
function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

/** Coerces an unknown value into a strict boolean (ASVS V5). */
function asBoolean(value: unknown): boolean {
  return value === true;
}

/**
 * Coerces an unknown value into a non-negative integer, falling back to
 * `fallback` for anything that isn't a finite, non-negative number (ASVS
 * V5) -- guards every synced rateLimit numeric field against a malformed/
 * hostile decrypted payload (negative, NaN, non-numeric, string injection).
 * Floors a valid finite float (e.g. 3.9 -> 3); `0` is a valid, preserved
 * value (0 means "unlimited" for rateLimit fields, not "missing").
 */
function asNonNegativeInt(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
    return fallback;
  return Math.floor(value);
}

/** Coerces an unknown value into a modes map, dropping keys whose value isn't a valid GroupNotificationMode (ASVS V5). */
function asModes(value: unknown): Record<string, GroupNotificationMode> {
  const modes: Record<string, GroupNotificationMode> = {};
  if (value === null || typeof value !== "object") return modes;

  for (const [key, mode] of Object.entries(value as Record<string, unknown>)) {
    if (isGroupNotificationMode(mode)) modes[key] = mode;
  }

  return modes;
}

/**
 * Coerces a raw decrypted `messages` object's category flags, with a D5-10/
 * Pitfall-5 fallback for a not-yet-upgraded peer device: if `raw.contacts` or
 * `raw.others` is present, this is a new-schema payload and each nested
 * `enabled` is coerced independently via `asBoolean`. Otherwise -- an
 * old-schema payload from a pre-Phase-5 peer, which only ever had a flat
 * `messages.enabled` -- BOTH categories are seeded from
 * `asBoolean(raw.enabled)` instead of silently coercing to `false`. Without
 * this fallback, a rolling multi-device upgrade would see the still-old
 * device's synced payload turn off DM notifications entirely on the already-
 * upgraded device (T-5-04).
 */
function asMessagesCategories(raw: Record<string, unknown>): {
  contacts: { enabled: boolean };
  others: { enabled: boolean };
} {
  if (raw.contacts !== undefined || raw.others !== undefined) {
    const contacts = (raw.contacts ?? {}) as Record<string, unknown>;
    const others = (raw.others ?? {}) as Record<string, unknown>;
    return {
      contacts: { enabled: asBoolean(contacts.enabled) },
      others: { enabled: asBoolean(others.enabled) },
    };
  }

  const legacyEnabled = asBoolean(raw.enabled);
  return {
    contacts: { enabled: legacyEnabled },
    others: { enabled: legacyEnabled },
  };
}

/**
 * Coerces a raw decrypted `rateLimit` field with the Pitfall-6 inverse
 * fallback: if `raw.rateLimit` is a non-null object (a Phase-6+ peer),
 * coerce each numeric field independently via `asNonNegativeInt`, falling
 * back per-field to this device's own `DEFAULT_RATE_LIMIT_CONFIG` when a
 * field is missing/malformed. If `raw.rateLimit` is absent or not an object
 * at all (a pre-Phase-6 peer, which never had this field), fall back to a
 * structuredClone of the ENTIRE `DEFAULT_RATE_LIMIT_CONFIG` -- NEVER to
 * `0`/unlimited. Unlike `asMessagesCategories`, there is no legacy
 * predecessor field to seed from, so "absent" must map to this device's own
 * safe local defaults, or a rolling multi-device upgrade would silently
 * disable rate limiting the moment an upgraded device applies an
 * un-upgraded peer's synced payload (RESEARCH Pitfall 6 / T-6-04).
 */
function asRateLimit(raw: Record<string, unknown>): SyncedPrefs["rateLimit"] {
  const rateLimit = raw.rateLimit;
  if (rateLimit === null || typeof rateLimit !== "object")
    return structuredClone(DEFAULT_RATE_LIMIT_CONFIG);

  const source = rateLimit as Record<string, unknown>;
  const perType = (source.perType ?? {}) as Record<string, unknown>;

  return {
    window: asNonNegativeInt(source.window, DEFAULT_RATE_LIMIT_CONFIG.window),
    global: asNonNegativeInt(source.global, DEFAULT_RATE_LIMIT_CONFIG.global),
    perType: {
      replies: asNonNegativeInt(
        perType.replies,
        DEFAULT_RATE_LIMIT_CONFIG.perType.replies,
      ),
      zaps: asNonNegativeInt(
        perType.zaps,
        DEFAULT_RATE_LIMIT_CONFIG.perType.zaps,
      ),
      messages: asNonNegativeInt(
        perType.messages,
        DEFAULT_RATE_LIMIT_CONFIG.perType.messages,
      ),
      groups: asNonNegativeInt(
        perType.groups,
        DEFAULT_RATE_LIMIT_CONFIG.perType.groups,
      ),
    },
  };
}

/**
 * ASVS V5 input validator/sanitizer for an untrusted decrypted kind-30078
 * payload (e.g. from another device, or a third-party interoperating app --
 * an explicit interop surface). Returns null if `value` is not a plain
 * object; otherwise coerces every field defensively (non-string whitelist/
 * blacklist entries dropped, invalid groups.modes entries dropped,
 * booleans/version coerced) so the result is always a well-formed
 * `SyncedPrefs` that cannot corrupt config on merge.
 */
export function sanitizeSyncedPrefs(value: unknown): SyncedPrefs | null {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return null;

  const raw = value as Record<string, unknown>;
  const messages = (raw.messages ?? {}) as Record<string, unknown>;
  const replies = (raw.replies ?? {}) as Record<string, unknown>;
  const zaps = (raw.zaps ?? {}) as Record<string, unknown>;
  const groups = (raw.groups ?? {}) as Record<string, unknown>;

  const version =
    typeof raw.version === "number" && !Number.isNaN(raw.version)
      ? raw.version
      : PREFS_VERSION;

  return {
    version,
    messages: {
      ...asMessagesCategories(messages),
      whitelists: asStringArray(messages.whitelists),
      blacklists: asStringArray(messages.blacklists),
    },
    replies: {
      enabled: asBoolean(replies.enabled),
      whitelists: asStringArray(replies.whitelists),
      blacklists: asStringArray(replies.blacklists),
    },
    zaps: {
      enabled: asBoolean(zaps.enabled),
      whitelists: asStringArray(zaps.whitelists),
      blacklists: asStringArray(zaps.blacklists),
    },
    groups: {
      enabled: asBoolean(groups.enabled),
      whitelists: asStringArray(groups.whitelists),
      blacklists: asStringArray(groups.blacklists),
      modes: asModes(groups.modes),
    },
    whitelists: asStringArray(raw.whitelists),
    blacklists: asStringArray(raw.blacklists),
    ...(typeof raw.appLink === "string" ? { appLink: raw.appLink } : {}),
    rateLimit: asRateLimit(raw),
  };
}

/**
 * D2-06 subset merge: applies an incoming (already-sanitized) `SyncedPrefs`
 * payload onto `current`, overwriting only the synced fields. Spreads
 * `current.messages`/`current.groups` first so `messages.sendContent` and
 * `groups.groupLink` -- never present on `incoming` -- survive untouched,
 * along with `current.signer`/`pubkey`/`server`/`topic`/`email`/
 * `lookupRelays` (D2-05).
 */
export function mergePrefs(
  current: AppConfig,
  incoming: SyncedPrefs,
): AppConfig {
  return {
    ...current,
    messages: {
      ...current.messages,
      contacts: { enabled: incoming.messages.contacts.enabled },
      others: { enabled: incoming.messages.others.enabled },
      whitelists: incoming.messages.whitelists,
      blacklists: incoming.messages.blacklists,
    },
    replies: { ...current.replies, ...incoming.replies },
    zaps: { ...current.zaps, ...incoming.zaps },
    groups: {
      ...current.groups,
      enabled: incoming.groups.enabled,
      whitelists: incoming.groups.whitelists,
      blacklists: incoming.groups.blacklists,
      modes: incoming.groups.modes,
    },
    whitelists: incoming.whitelists,
    blacklists: incoming.blacklists,
    appLink: incoming.appLink ?? current.appLink,
    rateLimit: { ...current.rateLimit, ...incoming.rateLimit },
  };
}

/**
 * D2-08 strict high-water-mark: true only when `candidateCreatedAt` is
 * strictly greater than `lastAppliedCreatedAt` -- an equal-or-older
 * `created_at` (e.g. a replayed event) is never considered newer.
 */
export function isNewerPrefs(
  candidateCreatedAt: number,
  lastAppliedCreatedAt: number,
): boolean {
  return candidateCreatedAt > lastAppliedCreatedAt;
}

/**
 * D2-09 loop-prevention primitive: true iff `a` and `b` serialize to the
 * exact same JSON. `serializePrefs` always builds keys in the same order,
 * so this is a stable canonical-JSON comparison usable to detect "this
 * inbound payload is just an echo of what we already published."
 */
export function samePrefsPayload(a: SyncedPrefs, b: SyncedPrefs): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
