import { defined, withImmediateValueOrDefault } from "applesauce-core";
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
import { configValue, getConfig } from "../services/config";
import {
  eventStore,
  giftWraps$,
  messageInboxes$,
  signer$,
  tagged$,
} from "../services/nostr";
import { sendNotification } from "../services/ntfy";
import { log } from "../services/logs";

/** If the direct message notifications are enabled */
export const enabled$ = configValue("directMessageNotifications").pipe(
  // Get signer and inboxes
  switchMap((enabled) =>
    enabled
      ? combineLatest([signer$, messageInboxes$]).pipe(
          // If signer and inboxes are defined, and there are inboxes, then the notifications are enabled
          map(([signer, relays]) => !!signer && !!relays && relays?.length > 0),
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
  .subscribe(async ({ profile, content }) => {
    if (!content) return;

    await sendNotification({
      title: `${getDisplayName(profile)} sent you a message`,
      message: content,
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
    const { pubkey } = getConfig();
    if (!pubkey) return;

    const sender = rumor.pubkey;
    const profile = await firstValueFrom(
      eventStore.profile(sender).pipe(defined()),
    );
    const content = rumor.content;

    await sendNotification({
      title: `${getDisplayName(profile)} sent you a message`,
      message: content,
      icon: getProfilePicture(profile),
    });
  });
