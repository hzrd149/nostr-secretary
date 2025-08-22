import { getNip10References } from "applesauce-core/helpers/threading";
import { filter, firstValueFrom, map, NEVER, switchMap } from "rxjs";

import { defined } from "applesauce-core";
import {
  addRelayHintsToPointer,
  getDisplayName,
  getProfilePicture,
} from "applesauce-core/helpers";
import { buildOpenLink } from "../helpers/config";
import { loadLists } from "../helpers/lists";
import config$, { getConfig } from "../services/config";
import { log } from "../services/logs";
import {
  blacklist$,
  eventStore,
  mailboxes$,
  tagged$,
  whitelist$,
} from "../services/nostr";
import { sendNotification } from "../services/ntfy";

/** Check if a sender should receive notifications based on whitelist/blacklist */
async function shouldNotify(pubkey: string): Promise<boolean> {
  const { replies } = getConfig();

  // If there are blacklists, check if sender is blacklisted
  if (replies.blacklists.length > 0) {
    const blacklistedPubkeys = await loadLists(replies.blacklists);
    if (blacklistedPubkeys.includes(pubkey)) return false;
  }

  // If there are whitelists, only allow whitelisted senders
  if (replies.whitelists.length > 0) {
    const whitelistedPubkeys = await loadLists(replies.whitelists);
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

export const enabled$ = config$.pipe(map((c) => c.replies.enabled));

log("Listening for replies");
enabled$
  .pipe(
    switchMap((enabled) =>
      enabled ? tagged$.pipe(filter((event) => event.kind === 1)) : NEVER,
    ),
  )
  .subscribe(async (event) => {
    const refs = getNip10References(event);
    if (!refs.reply?.e) return;

    const mailboxes = await firstValueFrom(mailboxes$);
    const pointer = addRelayHintsToPointer(refs.reply.e, mailboxes?.outboxes);

    // Get the event that was being replied to
    log("Fetching reply", { eventId: event.id, pointer });
    const parent = await firstValueFrom(
      eventStore.event(pointer).pipe(defined()),
    );

    // Quit if parent event cant be found
    if (!parent)
      return log("Failed to find parent event", {
        eventId: event.id,
        pointer: pointer,
      });

    const { pubkey } = getConfig();

    // Make sure the note was the users own
    if (parent.pubkey !== pubkey) return;

    // Check if we should notify for this sender
    if (!(await shouldNotify(event.pubkey)))
      return log(
        "Skipping reply notification for blacklisted/non-whitelisted sender",
        { sender: event.pubkey },
      );

    // Get the profile of the user who replied
    const profile = await firstValueFrom(
      eventStore.profile(event.pubkey).pipe(defined()),
    );

    // Send a notification
    await sendNotification({
      title: `${getDisplayName(profile)} replied to your post`,
      message: event.content,
      icon: getProfilePicture(profile),
      click: buildOpenLink(event),
    });
  });
