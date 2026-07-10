import { defined } from "applesauce-core";
import { getProfilePicture } from "applesauce-core/helpers";
import {
  getLegacyMessageReceiver,
  unlockLegacyMessage,
} from "applesauce-common/helpers";
import { kinds, type NostrEvent } from "nostr-tools";
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
import { classifyDmSender } from "./dm-category";
import { evaluateDmNotificationGates } from "./dm-notification-gate";
import { unlockPrivateDirectMessage } from "./gift-wrap-messages";
import {
  decryptLegacyDirectMessage,
  getMessageDisplayName,
} from "./legacy-messages";
import {
  blacklist$,
  eventStore,
  giftWraps$,
  isContact,
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
  map((c) => c.messages.contacts.enabled || c.messages.others.enabled),
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

    const { messages } = getConfig();

    // Check if this sender's category (contacts/others) is enabled (D5-07).
    // isContact's only guarded rejection is RxJS TimeoutError (via its own
    // `with` fallback) -- a genuine error from the underlying contacts$
    // observable would otherwise propagate as an unhandled rejection out of
    // this async subscribe callback (WR-01). Guard it here, log with
    // context, and fall back to treating the sender as NOT a contact so
    // classification degrades to "others" rather than dropping the
    // notification silently.
    let isFollowed = false;
    try {
      isFollowed = await isContact(sender);
    } catch (error) {
      log("Failed to resolve contact status, treating as others", {
        event: event.id,
        sender,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    const category = classifyDmSender(isFollowed);

    // D5-07 layered gate (category, then shouldNotify), extracted so the
    // real gate ordering has direct test coverage (WR-02) -- see
    // notifications/dm-notification-gate.ts.
    const gate = await evaluateDmNotificationGates(
      category,
      messages,
      sender,
      shouldNotify,
    );
    if (!gate.pass) {
      if (gate.reason === "category-disabled")
        return log("Skipping notification: category disabled", {
          sender,
          category,
        });
      return log(
        "Skipping notification for blacklisted/non-whitelisted sender",
        { sender },
      );
    }

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
        // Unwrap the gift wrap and classify the rumor
        mergeMap((event) => {
          log("Unlocking gift wrap", {
            event: event.id,
            signer: signer.pubkey,
          });

          return from(unlockPrivateDirectMessage(event, signer)).pipe(
            catchError((error) => {
              log("Failed to unlock gift wrap", {
                event: event.id,
                signer: signer.pubkey,
                error: error instanceof Error ? error.message : String(error),
              });
              // D4-05: deliberately NO reconnect-hint signal here -- a
              // failed gift-wrap unwrap is common/expected (spam, wraps
              // not addressed to this key), not permission-shaped.
              return EMPTY;
            }),
          );
        }),
        // unlockPrivateDirectMessage returns undefined for non-DM rumors
        defined(),
      ),
    ),
  )
  .subscribe(async (rumor) => {
    const { pubkey, messages } = getConfig();
    if (!pubkey) return;

    const sender = rumor.pubkey;

    // Check if this sender's category (contacts/others) is enabled (D5-07).
    // See the NIP-04 listener above for why this must be guarded (WR-01):
    // isContact only intercepts RxJS TimeoutError itself, so a genuine
    // contacts$ error would otherwise become an unhandled rejection here.
    let isFollowed = false;
    try {
      isFollowed = await isContact(sender);
    } catch (error) {
      log("Failed to resolve contact status, treating as others", {
        event: rumor.id,
        sender,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    const category = classifyDmSender(isFollowed);

    // D5-07 layered gate (category, then shouldNotify), extracted so the
    // real gate ordering has direct test coverage (WR-02) -- see
    // notifications/dm-notification-gate.ts.
    const gate = await evaluateDmNotificationGates(
      category,
      messages,
      sender,
      shouldNotify,
    );
    if (!gate.pass) {
      if (gate.reason === "category-disabled")
        return log("Skipping notification: category disabled", {
          sender,
          category,
        });
      return log(
        "Skipping notification for blacklisted/non-whitelisted sender",
        {
          sender,
        },
      );
    }

    // A profile-lookup timeout must never throw into this subscribe
    // callback nor render a literal "undefined" title (parity with the
    // NIP-04 block's WR-01 fix).
    const profile = await getValue(eventStore.profile(sender)).catch(
      () => undefined,
    );
    const content = rumor.content;
    const displayName = getMessageDisplayName(profile, sender);

    await sendNotification({
      title: `${displayName} sent you a message`,
      message: messages.sendContent ? content : "[content omitted]",
      icon: getProfilePicture(profile),
      // D4-04: buildOpenLink only reads .id/.kind/.pubkey internally --
      // safe on the unsigned rumor despite missing `.sig`. Built from the
      // rumor (real sender), never the gift wrap (random one-time pubkey).
      click: buildOpenLink(rumor as unknown as NostrEvent),
    });
  });
