import { defined } from "applesauce-core";
import {
  addRelayHintsToPointer,
  getProfilePointersFromList,
  isAddressPointer,
  parseCoordinate,
} from "applesauce-core/helpers";
import { decode, type AddressPointer } from "nostr-tools/nip19";
import { firstValueFrom, of, timeout } from "rxjs";
import { eventStore, mailboxes$ } from "../services/nostr";

/** Loads a list of list coordinates or naddr and gets the pubkeys from them */
export async function loadLists(lists: string[]): Promise<string[]> {
  const mailboxes = await firstValueFrom(
    mailboxes$.pipe(timeout({ first: 2000, with: () => of(undefined) })),
  );

  const pointers = lists
    .map((addr) => {
      if (addr.startsWith("naddr1")) return decode(addr).data as AddressPointer;
      else if (addr.includes(":")) return parseCoordinate(addr);
      else return null;
    })
    .filter((pointer) => pointer !== null);

  const requests = await Promise.allSettled(
    pointers.map((pointer) => {
      // Request all lists from user outboxes
      const withRelays = addRelayHintsToPointer(pointer, mailboxes?.outboxes);

      return firstValueFrom(
        (isAddressPointer(withRelays)
          ? eventStore.addressable(withRelays)
          : eventStore.replaceable(withRelays)
        ).pipe(defined(), timeout({ first: 2000, with: () => of(undefined) })),
      );
    }),
  );

  const events = requests
    .filter((request) => request.status === "fulfilled")
    .map((request) => request.value)
    .filter((v) => v !== undefined);

  const pubkeys = new Set<string>();
  for (const event of events) {
    for (const pointer of getProfilePointersFromList(event)) {
      pubkeys.add(pointer.pubkey);
    }
  }

  return Array.from(pubkeys);
}
