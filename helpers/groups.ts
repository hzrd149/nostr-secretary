import { firstValueFrom, of, timeout } from "rxjs";
import { pool } from "../services/nostr";
import {
  encodeGroupPointer,
  type GroupPointer,
} from "applesauce-common/helpers";
import {
  getContentPointers,
  getPubkeyFromDecodeResult,
} from "applesauce-core/helpers";
import type { NostrEvent } from "nostr-tools";

const cache = new Map<string, NostrEvent>();

export async function getGroupMetadata(
  group: GroupPointer,
): Promise<NostrEvent | undefined> {
  const cached = cache.get(encodeGroupPointer(group));
  if (cached) return cached;

  const metadata = await firstValueFrom(
    pool
      .relay(group.relay)
      .request({ kinds: [39000], limit: 1, "#d": [group.id] })
      .pipe(timeout({ first: 2000, with: () => of(undefined) })),
  );

  if (metadata) cache.set(encodeGroupPointer(group), metadata);
  return metadata;
}

/** Per-group notification mode: receive all messages, only @mentions, or none (D-01) */
export type GroupNotificationMode = "all" | "mentions" | "muted";

/** Default mode for any group not present in the per-group mode map (D-06) */
export const DEFAULT_GROUP_NOTIFICATION_MODE: GroupNotificationMode =
  "mentions";

/** Returns true if `message` mentions `pubkey` via a "p" tag or a nostr: content reference (D-02) */
export function messageMentionsPubkey(
  message: NostrEvent,
  pubkey: string,
): boolean {
  const pTagged = message.tags.some((t) => t[0] === "p" && t[1] === pubkey);
  if (pTagged) return true;

  return getContentPointers(message.content).some(
    (pointer) => getPubkeyFromDecodeResult(pointer) === pubkey,
  );
}

/** Resolves whether a group message should proceed past the mode gate (D-01/D-09 step 2) */
export function passesGroupModeGate(
  mode: GroupNotificationMode,
  message: NostrEvent,
  userPubkey: string,
): boolean {
  switch (mode) {
    case "muted":
      return false;
    case "mentions":
      return messageMentionsPubkey(message, userPubkey);
    case "all":
      return true;
  }
}

/** Looks up a group's configured mode, falling back to the default (D-06).
 *  Defensive against a `modes` map that is missing, `null`, or contains a
 *  value that isn't one of the three literal modes (e.g. a hand-edited or
 *  pre-validation config.json entry) -- always re-validates the stored
 *  value via isGroupNotificationMode rather than trusting it as-is (WR-02).
 */
export function getGroupMode(
  modes: Record<string, GroupNotificationMode> | undefined | null,
  group: GroupPointer,
): GroupNotificationMode {
  const stored = modes?.[encodeGroupPointer(group)];
  return isGroupNotificationMode(stored)
    ? stored
    : DEFAULT_GROUP_NOTIFICATION_MODE;
}

/** Per-mode counts for the /notifications Groups card summary (D-05) */
export function summarizeGroupModes(
  modes: Record<string, GroupNotificationMode>,
): { all: number; mentions: number; muted: number } {
  const counts = { all: 0, mentions: 0, muted: 0 };
  for (const mode of Object.values(modes)) counts[mode]++;
  return counts;
}

/** ASVS V5 input validator: narrows an untrusted value to GroupNotificationMode (used by the /groups PATCH handler) */
export function isGroupNotificationMode(
  value: unknown,
): value is GroupNotificationMode {
  return value === "all" || value === "mentions" || value === "muted";
}
