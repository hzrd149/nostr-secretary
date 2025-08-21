import { defined, EventStore, mapEventsToStore } from "applesauce-core";
import { getRelaysFromList, unixNow } from "applesauce-core/helpers";
import {
  createAddressLoader,
  createEventLoader,
} from "applesauce-loaders/loaders";
import { onlyEvents, RelayPool } from "applesauce-relay";
import {
  combineLatest,
  filter,
  map,
  share,
  shareReplay,
  switchMap,
} from "rxjs";

import config, { configValue } from "./config";
import { kinds } from "nostr-tools";

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
  switchMap((user) => eventStore.mailboxes(user)),
  shareReplay(1),
);

/** An observable of the users direct message relays */
export const messageInboxes$ = combineLatest([user$, mailboxes$]).pipe(
  switchMap(([user, mailboxes]) =>
    eventStore.replaceable({
      kind: kinds.DirectMessageRelaysList,
      pubkey: user,
      relays: mailboxes?.outboxes,
    }),
  ),
  map((event) => (event ? getRelaysFromList(event) : undefined)),
  shareReplay(1),
);

/** A single subscription of all events that are sent to the users inboxes that have a "#p" tag of the users pubkey  */
export const tagged$ = combineLatest([user$, mailboxes$.pipe(defined())]).pipe(
  switchMap(([user, mailboxes]) =>
    pool
      .subscription(
        mailboxes?.inboxes,
        {
          // Events tagging the users pubkey
          "#p": [user],
          // Only new events
          since: unixNow() - 1,
        },
        { reconnect: true },
      )
      .pipe(
        onlyEvents(),
        // Ingore events from the user themselves
        filter((event) => event.pubkey !== user),
        mapEventsToStore(eventStore),
      ),
  ),
  share(),
);

/** An observable of all messages sent to the users direct message relays */
export const messages$ = combineLatest([
  user$,
  messageInboxes$.pipe(defined()),
]).pipe(
  switchMap(([user, messageInboxes]) =>
    pool.subscription(
      messageInboxes,
      {
        "#p": [user],
        // Listen for NIP-17 gift wraps
        kinds: [kinds.EncryptedDirectMessage],
        since: unixNow() - 1,
      },
      { reconnect: true },
    ),
  ),
  onlyEvents(),
  mapEventsToStore(eventStore),
  share(),
);
