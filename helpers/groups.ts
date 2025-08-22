import { firstValueFrom, of, timeout } from "rxjs";
import { pool } from "../services/nostr";
import { encodeGroupPointer, type GroupPointer } from "applesauce-core/helpers";
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
