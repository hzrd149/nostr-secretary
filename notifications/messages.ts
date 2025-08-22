import { defined } from "applesauce-core";
import {
  getDisplayName,
  getLegacyMessageCorraspondant,
  getProfilePicture,
  unlockGiftWrap,
  unlockLegacyMessage,
} from "applesauce-core/helpers";
import { kinds } from "nostr-tools";
import {
  catchError,
  combineLatest,
  EMPTY,
  filter,
  firstValueFrom,
  from,
  map,
  mergeMap,
  of,
  shareReplay,
  switchMap,
  tap,
} from "rxjs";

import { loadLists } from "../helpers/lists";
import config$, { getConfig } from "../services/config";
import { log } from "../services/logs";
import {
  blacklist$,
  eventStore,
  giftWraps$,
  messageInboxes$,
  signer$,
  tagged$,
  whitelist$,
} from "../services/nostr";
import { sendNotification } from "../services/ntfy";

/** Check if a sender should receive notifications based on whitelist/blacklist */
async function shouldNotify(pubkey: string): Promise<boolean> {
  const { messages } = getConfig();

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
  const whitelist = await firstValueFrom(whitelist$);
  if (whitelist.length > 0 && !whitelist.includes(pubkey)) return false;

  // if they are on the global blacklist
  const blacklist = await firstValueFrom(blacklist$);
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

const enbaledSigner = combineLatest([enabled$, signer$]).pipe(
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

// Listen for NIP-04 messages
enbaledSigner
  .pipe(
    // Switch to listening for incoming events
    switchMap((signer) =>
      tagged$.pipe(
        filter((event) => event.kind === kinds.EncryptedDirectMessage),
        mergeMap(async (event) => {
          const { pubkey } = getConfig();
          if (!pubkey) return;

          const sender = getLegacyMessageCorraspondant(event, pubkey);
          const profile = await firstValueFrom(
            eventStore.profile(sender).pipe(defined()),
          );

          log("Unlocking legacy message", {
            event: event.id,
            sender,
            signer: signer.pubkey,
          });

          const content = await unlockLegacyMessage(event, pubkey, signer);
          if (!content) return;

          return { sender, profile, content };
        }),
      ),
    ),
    defined(),
  )
  .subscribe(async ({ sender, profile, content }) => {
    if (!content) return;

    // Check if we should notify for this sender
    if (!(await shouldNotify(sender)))
      return log(
        "Skipping notification for blacklisted/non-whitelisted sender",
        { sender },
      );

    const { messages } = getConfig();
    const displayName = getDisplayName(profile);

    await sendNotification({
      title: `${displayName} sent you a message`,
      message: messages.sendContent ? content : "[content omitted]",
      icon: getProfilePicture(profile),
    });
  });

// Listen for NIP-17 messages
enbaledSigner
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

    const profile = await firstValueFrom(
      eventStore.profile(sender).pipe(defined()),
    );
    const content = rumor.content;
    const displayName = getDisplayName(profile);

    await sendNotification({
      title: `${displayName} sent you a message`,
      message: messages.sendContent ? content : "[content omitted]",
      icon: getProfilePicture(profile),
    });
  });
