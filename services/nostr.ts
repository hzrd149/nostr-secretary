import { NostrConnectAccount } from "applesauce-accounts/accounts";
import {
  getGroupPointerFromGroupTag,
  getHiddenMutedThings,
  getMutedThings,
  getRelaysFromList,
  isHiddenMutesUnlocked,
  mergeMutes,
  unlockHiddenMutes,
} from "applesauce-common/helpers";
import {
  defined,
  EventStore,
  mapEventsToStore,
  simpleTimeout,
} from "applesauce-core";
import {
  hasHiddenTags,
  mergeRelaySets,
  unixNow,
} from "applesauce-core/helpers";
import {
  createEventLoaderForStore,
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
  firstValueFrom,
  map,
  merge,
  NEVER,
  of,
  ReplaySubject,
  share,
  shareReplay,
  skip,
  startWith,
  switchMap,
  timeout,
  timer,
  toArray,
  type MonoTypeOperatorFunction,
} from "rxjs";
import { loadLists } from "../helpers/lists";
import config$, { configValue } from "./config";
import { log } from "./logs";

function shareAndHold<T>(timeout = 60_000): MonoTypeOperatorFunction<T> {
  return share({
    resetOnRefCountZero: () => timer(timeout),
    connector: () => new ReplaySubject(1),
  });
}

export const eventStore = new EventStore();
export const pool = new RelayPool({
  enablePing: true,
  onUnresponsive: () => "reconnect",
});

// Setup bunker signers
NostrConnectSigner.subscriptionMethod = pool.subscription.bind(pool);
NostrConnectSigner.publishMethod = pool.publish.bind(pool);

const lookupRelays = config$.pipe(map((c) => c.lookupRelays));
export const eventLoader = createEventLoaderForStore(eventStore, pool, {
  lookupRelays,
});

export const listsLoader = createUserListsLoader(pool, {
  eventStore,
  kinds: [kinds.CommunitiesList, kinds.Followsets],
});

// Setup loader on event store
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
      // Timeout after 10 seconds
      simpleTimeout(10_000),
    );
  }),
  // Keep observable warm for 60s
  shareAndHold(60_000),
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

export const groups$ = combineLatest([user$, mailboxes$]).pipe(
  switchMap(([user, mailboxes]) => {
    if (!user || !mailboxes) return EMPTY;
    return eventStore.replaceable({
      kind: 10009,
      pubkey: user,
    });
  }),
  // Cache value fro 60s
  shareAndHold(),
);

/** Observable of unique group relay URLs from the users kind 10009 group list */
const groupRelays$ = groups$.pipe(
  map((list) => {
    if (!list) return [];
    return [
      ...new Set(
        list.tags
          .filter((t) => t[0] === "group" && t[1])
          .map(getGroupPointerFromGroupTag)
          .map((g) => g.relay),
      ),
    ];
  }),
  startWith([] as string[]),
);

// Attempt to authenticate to relays
combineLatest([signer$, mailboxes$, messageInboxes$, groupRelays$])
  .pipe(
    switchMap(([signer, mailboxes, messageInboxes, groupRelays]) => {
      if (!signer) return EMPTY;

      return merge(
        ...mergeRelaySets(
          mailboxes?.inboxes,
          messageInboxes,
          groupRelays,
        )
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
        { reconnect: Infinity, resubscribe: true },
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
      { reconnect: Infinity },
    ),
  ),
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

/**
 * An observable of the set of pubkeys the user has muted (NIP-51 kind 10000).
 * Includes private (encrypted) mutes when a signer is available.
 */
export const mutedPubkeys$ = combineLatest([
  user$.pipe(
    switchMap((user) =>
      eventStore.replaceable({ kind: kinds.Mutelist, pubkey: user }),
    ),
  ),
  signer$,
]).pipe(
  switchMap(async ([event, signer]) => {
    if (!event) return new Set<string>();

    // Decrypt the private mutes if a signer is available and they aren't unlocked yet
    if (signer && hasHiddenTags(event) && !isHiddenMutesUnlocked(event)) {
      try {
        await unlockHiddenMutes(event, signer);
      } catch (error) {
        log("Failed to unlock private mutes", {
          error: Reflect.get(error as object, "message") || "Unknown error",
        });
      }
    }

    // getMutedThings merges the public mutes with the hidden mutes (if unlocked)
    const hidden = getHiddenMutedThings(event);
    const mutes = getMutedThings(event);
    return hidden ? mergeMutes(mutes, hidden).pubkeys : mutes.pubkeys;
  }),
  // Cache value for 60s
  shareAndHold(),
);

/** Returns true if the user has muted the given pubkey */
export async function isMuted(pubkey: string): Promise<boolean> {
  const muted = await firstValueFrom(
    // Fall back to an empty set if the mute list cannot be loaded in time
    mutedPubkeys$.pipe(
      timeout({ first: 2000, with: () => of(new Set<string>()) }),
    ),
  );
  return muted.has(pubkey);
}

/** An observable that loads the users people lists */
export const lists$ = combineLatest([user$, mailboxes$]).pipe(
  switchMap(([user, mailboxes]) =>
    listsLoader({ pubkey: user, relays: mailboxes?.outboxes }).pipe(toArray()),
  ),
  // cache value fro 60s
  shareAndHold(),
);
