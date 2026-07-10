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
import { onlyEvents } from "applesauce-relay";
import { kinds } from "nostr-tools";
import {
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
  startWith,
  switchMap,
  timeout,
  timer,
  toArray,
  type MonoTypeOperatorFunction,
} from "rxjs";
import { seededGiftWraps } from "../helpers/gift-wrap-subscription";
import { loadLists } from "../helpers/lists";
import config$, { configValue } from "./config";
import { log } from "./logs";
import { pool } from "./relays";
import { signer$ } from "./signer";

export { pool } from "./relays";
export { signer$ } from "./signer";

function shareAndHold<T>(timeout = 60_000): MonoTypeOperatorFunction<T> {
  return share({
    resetOnRefCountZero: () => timer(timeout),
    connector: () => new ReplaySubject(1),
  });
}

export const eventStore = new EventStore();

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
        ...mergeRelaySets(mailboxes?.inboxes, messageInboxes, groupRelays)
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

/** An observable of all messages sent to the users direct message relays.
 *  Only emits GENUINELY NEW gift wraps -- historical wraps fetched during
 *  the seed phase (below) are stored but never emitted here (D4-02). */
export const giftWraps$ = combineLatest([
  // Wait for a user to be defined
  user$,
  // Wait for message inboxes to be defined
  messageInboxes$.pipe(defined()),
]).pipe(
  switchMap(([user, messageInboxes]) => {
    const giftWrapFilter = {
      "#p": [user],
      // Listen for NIP-17 gift wraps
      kinds: [kinds.GiftWrap],
    };

    // Seed: one-shot fetch of the current backlog, completes on EOSE
    // (pool.request's default complete condition). Persisted directly into
    // the real eventStore; never reaches subscribers of this observable.
    const seedRequest$ = pool.request(messageInboxes, giftWrapFilter, {
      eventStore,
      timeout: 10_000,
    });

    // Live: persistent subscription, reconnect forever (unchanged shape).
    const live$ = pool.subscription(messageInboxes, giftWrapFilter, {
      reconnect: Infinity,
    });

    // CR-01: a seed failure (timeout/relay error) must NEVER fall through
    // to `live$` with an empty `seen` set -- `live$` is a fresh REQ and
    // will resend the entire matching history (Pitfall 1, no `since`
    // filter since NIP-59 randomizes `created_at`), which would otherwise
    // re-notify every historical gift-wrapped DM. `seededGiftWraps` retries
    // the seed with backoff, logs on final failure (WR-03), and fails
    // closed (suppresses this cycle's notifications entirely) rather than
    // risking a mass re-notification storm.
    return seededGiftWraps(seedRequest$, live$, {
      onSeedFailure: (error) =>
        log(
          "Gift wrap seed request failed after retries -- suppressing live gift-wrap notifications until the next resubscribe to avoid mass re-notification of historical DMs",
          { error: error instanceof Error ? error.message : String(error) },
        ),
    });
  }),
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
