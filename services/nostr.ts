import {
  createAddressLoader,
  createEventLoader,
} from "applesauce-loaders/loaders";
import { onlyEvents, RelayPool } from "applesauce-relay";
import { combineLatest, map, share, switchMap } from "rxjs";

import config, { configValue } from "./config";
import { defined, EventStore, mapEventsToStore } from "applesauce-core";
import { unixNow } from "applesauce-core/helpers";

export const eventStore = new EventStore();
export const pool = new RelayPool();

const lookupRelays = config.pipe(map((c) => c.lookupRelays));
export const addressLoader = createAddressLoader(pool, { lookupRelays });
export const eventLoader = createEventLoader(pool);

// Setup loaders on event store
eventStore.replaceableLoader = addressLoader;
eventStore.addressableLoader = addressLoader;
eventStore.eventLoader = eventLoader;

/** The current users hex pubkey */
export const user$ = configValue("pubkey").pipe(defined());

/** The users inbox and outbox relays */
export const mailboxes$ = user$.pipe(
  switchMap((pubkey) => eventStore.mailboxes(pubkey).pipe(defined())),
  share(),
);

/** A single subscription of all events that are sent to the users inboxes that have a "#p" tag of the users pubkey  */
export const tagged$ = combineLatest([user$, mailboxes$]).pipe(
  switchMap(([pubkey, mailboxes]) =>
    pool
      .subscription(mailboxes?.inboxes, {
        // Events tagging the users pubkey
        "#p": [pubkey],
        // Only new events
        since: unixNow() - 1,
      })
      .pipe(onlyEvents(), mapEventsToStore(eventStore)),
  ),
  share(),
);
