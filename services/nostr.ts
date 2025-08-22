import {
  defined,
  EventStore,
  mapEventsToStore,
  simpleTimeout,
} from "applesauce-core";
import {
  getRelaysFromList,
  mergeRelaySets,
  unixNow,
} from "applesauce-core/helpers";
import {
  createAddressLoader,
  createEventLoader,
  createUserListsLoader,
} from "applesauce-loaders/loaders";
import { onlyEvents, RelayPool } from "applesauce-relay";
import { NostrConnectSigner } from "applesauce-signers";
import { kinds } from "nostr-tools";
import {
  BehaviorSubject,
  combineLatest,
  EMPTY,
  filter,
  map,
  merge,
  mergeWith,
  NEVER,
  of,
  share,
  shareReplay,
  skip,
  switchMap,
  toArray,
} from "rxjs";

import { NostrConnectAccount } from "applesauce-accounts/accounts";
import config$, { configValue } from "./config";
import { log } from "./logs";
import { loadLists } from "../helpers/lists";

export const eventStore = new EventStore();
export const pool = new RelayPool();

// Setup bunker signers
NostrConnectSigner.subscriptionMethod = pool.subscription.bind(pool);
NostrConnectSigner.publishMethod = pool.publish.bind(pool);

const lookupRelays = config$.pipe(map((c) => c.lookupRelays));
export const addressLoader = createAddressLoader(pool, { lookupRelays });
export const eventLoader = createEventLoader(pool);

export const listsLoader = createUserListsLoader(pool, {
  eventStore,
  kinds: [kinds.CommunitiesList, kinds.Followsets],
});

// Setup loaders on event store
eventStore.replaceableLoader = addressLoader;
eventStore.addressableLoader = addressLoader;
eventStore.eventLoader = eventLoader;

/** The current users hex pubkey */
export const user$ = configValue("pubkey").pipe(defined());

/** The users inbox and outbox relays */
export const mailboxes$ = configValue("pubkey").pipe(
  switchMap((user) =>
    user
      ? eventStore.mailboxes(user).pipe(
          // Only request once
          shareReplay(1),
          // Timeout after 10 seconds
          simpleTimeout(10_000),
        )
      : NEVER,
  ),
);

/** An observable of the users direct message relays */
export const messageInboxes$ = configValue("pubkey").pipe(
  switchMap((user) => {
    if (!user) return NEVER;

    return mailboxes$.pipe(
      switchMap((mailboxes) =>
        eventStore.replaceable({
          kind: kinds.DirectMessageRelaysList,
          pubkey: user,
          relays: mailboxes?.outboxes,
        }),
      ),
      map((event) => (event ? getRelaysFromList(event) : undefined)),
      // Only request once
      shareReplay(1),
      // Timeout after 10 seconds
      simpleTimeout(10_000),
    );
  }),
);

/** An observable of the users signer */
export const signer$ = new BehaviorSubject<NostrConnectAccount<any> | null>(
  null,
);

// Update the account when the signer changes
configValue("signer")
  .pipe()
  .subscribe((signer) => {
    if (!signer) return;
    if (signer.id === signer$.value?.id) return;

    log("Restoring signer", { pubkey: signer.pubkey });

    // Only support nostr-connect
    switch (signer.type) {
      case "nostr-connect":
        signer$.next(NostrConnectAccount.fromJSON(signer));
        break;
      default:
        log("Unsupported signer type", { type: signer.type });
    }
  });

// Attempt to authenticate to relays
combineLatest([signer$, mailboxes$, messageInboxes$])
  .pipe(
    switchMap(([signer, mailboxes, messageInboxes]) => {
      if (!signer) return EMPTY;

      return merge(
        ...mergeRelaySets(mailboxes?.inboxes, messageInboxes)
          // Get the relays
          .map((url) => pool.relay(url))
          // Create an observable that watches all nessiary state
          .map((relay) =>
            combineLatest({
              relay: of(relay),
              signer: of(signer),
              authenticated: relay.authenticated$,
              response: relay.authenticationResponse$,
              required: relay.authRequiredForRead$,
              challenge: relay.challenge$,
            }),
          ),
      );
    }),
  )
  .subscribe(
    async ({ relay, signer, authenticated, response, required, challenge }) => {
      if (required && !authenticated && !response && challenge) {
        log("Authenticating to relay", { relay: relay.url });

        try {
          await relay.authenticate(signer);
          log("Authenticated to relay", { relay: relay.url });
        } catch (error) {
          log("Error authenticating to relay", {
            relay: relay.url,
            error,
            response: relay.authenticationResponse,
          });
        }
      }
    },
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
export const giftWraps$ = combineLatest([
  // Wait for a user to be defined
  user$,
  // Wait for message inboxes to be defined
  messageInboxes$.pipe(defined()),
]).pipe(
  switchMap(([user, messageInboxes]) =>
    pool.subscription(
      messageInboxes,
      {
        "#p": [user],
        // Listen for NIP-17 gift wraps
        kinds: [kinds.GiftWrap],
        // Use limit 1 because ts on gift wraps is random
        limit: 1,
      },
      { reconnect: true },
    ),
  ),
  onlyEvents(),
  // Skip the first event since we only want new ones
  skip(1),
  mapEventsToStore(eventStore),
  share(),
);

/** An observable of the global whitelist */
export const whitelist$ = configValue("whitelists").pipe(
  switchMap(loadLists),
  shareReplay(1),
);

/** An observable of the global blacklist */
export const blacklist$ = configValue("blacklists").pipe(
  switchMap(loadLists),
  shareReplay(1),
);

export const groups$ = combineLatest([user$, mailboxes$]).pipe(
  switchMap(([user, mailboxes]) => {
    if (!user || !mailboxes) return EMPTY;
    return eventStore.replaceable({
      kind: 10009,
      pubkey: user,
    });
  }),
);

/** An observable that loads the users people lists */
export const peopleLists$ = combineLatest([user$, mailboxes$]).pipe(
  switchMap(([user, mailboxes]) =>
    listsLoader({ pubkey: user, relays: mailboxes?.outboxes }).pipe(
      toArray(),
      mergeWith(NEVER),
    ),
  ),
  shareReplay(1),
);
