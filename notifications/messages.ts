import { defined } from "applesauce-core";
import { getDisplayName, getProfilePicture } from "applesauce-core/helpers";
import {
  getLegacyMessageReceiver,
  unlockGiftWrap,
  unlockLegacyMessage,
} from "applesauce-common/helpers";
import { kinds } from "nostr-tools";
import {
  BehaviorSubject,
  catchError,
  combineLatest,
  EMPTY,
  filter,
  from,
  map,
  mergeMap,
  of,
  shareReplay,
  switchMap,
  tap,
} from "rxjs";

import { buildOpenLink } from "../helpers/link";
import { loadLists } from "../helpers/lists";
import { getValue } from "../helpers/observable";
import config$, { getConfig } from "../services/config";
import { log } from "../services/logs";
import {
  decryptLegacyDirectMessage,
  getMessageDisplayName,
} from "./legacy-messages";
import {
  blacklist$,
  eventStore,
  giftWraps$,
  isMuted,
  messageInboxes$,
  signer$,
  tagged$,
  whitelist$,
} from "../services/nostr";
import { sendNotification } from "../services/ntfy";

/** Check if a sender should receive notifications based on whitelist/blacklist */
async function shouldNotify(pubkey: string): Promise<boolean> {
  const { messages } = getConfig();

  // Never notify for pubkeys the user has muted (NIP-51 kind 10000)
  if (await isMuted(pubkey)) return false;

  // If there are blacklists, check if sender is blacklisted
  if (messages.blacklists.length > 0) {
    const blacklistedPubkeys = await loadLists(messages.blacklists);
    if (blacklistedPubkeys.includes(pubkey)) return false;
  }

  // If there are whitelists, only allow whitelisted senders
  if (messages.whitelists.length > 0) {
    const whitelistedPubkeys = await loadLists(messages.whitelists);
    return whitelistedPubkeys.includes(pubkey);
  }

  // if they are not on the global whitelist
  const whitelist = await getValue(whitelist$);
  if (whitelist.length > 0 && !whitelist.includes(pubkey)) return false;

  // if they are on the global blacklist
  const blacklist = await getValue(blacklist$);
  if (blacklist.length > 0 && blacklist.includes(pubkey)) return false;

  // If no whitelists, allow everyone (except blacklisted)
  return true;
}

/** If the direct message notifications are enabled */
export const enabled$ = config$.pipe(
  map((c) => c.messages.enabled),
  // Get signer and inboxes
  switchMap((enabled) =>
    enabled
      ? messageInboxes$.pipe(
          // If signer and inboxes are defined, and there are inboxes, then the notifications are enabled
          map((relays) => !!relays && relays?.length > 0),
        )
      : of(false),
  ),
  // Cache the result
  shareReplay(1),
);

const enabledSigner = combineLatest([enabled$, signer$]).pipe(
  filter(([enabled, signer]) => enabled && !!signer),
  map(([_, signer]) => signer),
  defined(),
  tap((signer) => {
    log("Listening for incoming legacy messages", {
      signer: signer.pubkey,
    });
  }),
  shareReplay(1),
);

/**
 * True while a NIP-04 legacy-DM decrypt has failed for an already-connected
 * signer (e.g. a bunker that was never granted `nip04_decrypt`). Reset to
 * false as soon as a decrypt succeeds again, so a non-blocking reconnect
 * hint (see pages/notifications.tsx#DmDecryptHint) can clear itself once
 * decryption starts working (D3-07).
 */
export const nip04DecryptDegraded$ = new BehaviorSubject(false);

// Listen for NIP-04 messages
enabledSigner
  .pipe(
    // Switch to listening for incoming events
    switchMap((signer) =>
      tagged$.pipe(
        filter((event) => event.kind === kinds.EncryptedDirectMessage),
        mergeMap((event) => {
          const { pubkey } = getConfig();
          if (!pubkey) return EMPTY;

          const sender = getLegacyMessageReceiver(event, pubkey);
          if (!sender) return EMPTY;

          return from(
            decryptLegacyDirectMessage(event, pubkey, sender, signer, {
              // A profile-lookup failure (e.g. getValue's 5s timeout when
              // the sender's kind-0 hasn't loaded yet) is swallowed inside
              // decryptLegacyDirectMessage -- it is NOT a decrypt failure
              // and must not reach the catchError below (WR-01).
              getProfile: (sender) =>
                getValue(eventStore.profile(sender).pipe(defined())),
              unlock: unlockLegacyMessage,
              log,
            }),
          ).pipe(
            map((result) => {
              // Decrypt succeeded with content -- clear any previously-set
              // reconnect hint. (A falsy result means unlockLegacyMessage
              // resolved without throwing but yielded empty content --
              // not a decrypt failure, but also not treated as a
              // hint-clearing success, matching pre-WR-04 behavior.)
              if (result) nip04DecryptDegraded$.next(false);
              return result;
            }),
            catchError((error) => {
              log("Failed to unlock legacy message", {
                event: event.id,
                signer: signer.pubkey,
                error: error instanceof Error ? error.message : String(error),
              });
              // D3-07: any NIP-04 decrypt failure while connected is
              // reconnect-hint-worthy (no standardized NIP-46
              // permission-denied error code to string-match against).
              // Profile-lookup failures no longer reach this catchError
              // (see decryptLegacyDirectMessage), so this only fires for
              // actual decrypt errors (WR-01).
              nip04DecryptDegraded$.next(true);
              return EMPTY;
            }),
          );
        }),
      ),
    ),
    defined(),
  )
  .subscribe(async ({ sender, profile, content, event }) => {
    if (!content) return;

    // Check if we should notify for this sender
    if (!(await shouldNotify(sender)))
      return log(
        "Skipping notification for blacklisted/non-whitelisted sender",
        { sender },
      );

    const { messages } = getConfig();
    // Use the shared fallback-aware helper (WR-01): `profile` may be
    // `undefined` here on purpose (a swallowed profile-lookup timeout), and
    // getDisplayName(profile) alone has no npub fallback for a bare
    // ProfileContent -- only for a full signed NostrEvent.
    const displayName = getMessageDisplayName(profile, sender);

    await sendNotification({
      title: `${displayName} sent you a message`,
      message: messages.sendContent ? content : "[content omitted]",
      icon: getProfilePicture(profile),
      click: buildOpenLink(event),
    });
  });

// Listen for NIP-17 messages
enabledSigner
  .pipe(
    // Switch to listening for gift wraps
    switchMap((signer) =>
      giftWraps$.pipe(
        // Get the rumor from the gift wrap
        mergeMap((event) => {
          log("Unlocking gift wrap", {
            event: event.id,
            signer: signer.pubkey,
          });

          return from(unlockGiftWrap(event, signer)).pipe(
            catchError((error) => {
              log("Failed to unlock gift wrap", {
                event: event.id,
                signer: signer.pubkey,
                error: Reflect.get(error, "message") || "Unknown error",
              });
              return EMPTY;
            }),
          );
        }),
      ),
    ),
    // Only look for private direct messages
    filter((rumor) => rumor.kind === kinds.PrivateDirectMessage),
  )
  .subscribe(async (rumor) => {
    const { pubkey, messages } = getConfig();
    if (!pubkey) return;

    const sender = rumor.pubkey;

    // Check if we should notify for this sender
    if (!(await shouldNotify(sender)))
      return log(
        "Skipping notification for blacklisted/non-whitelisted sender",
        {
          sender,
        },
      );

    const profile = await getValue(eventStore.profile(sender));
    const content = rumor.content;
    const displayName = getDisplayName(profile);

    await sendNotification({
      title: `${displayName} sent you a message`,
      message: messages.sendContent ? content : "[content omitted]",
      icon: getProfilePicture(profile),
    });
  });
