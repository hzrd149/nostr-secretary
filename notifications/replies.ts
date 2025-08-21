import { getNip10References } from "applesauce-core/helpers/threading";
import { filter, firstValueFrom, map } from "rxjs";

import { defined } from "applesauce-core";
import {
  addRelayHintsToPointer,
  getDisplayName,
  getProfilePicture,
} from "applesauce-core/helpers";
import { buildOpenLink } from "../helpers/config";
import { configValue, getConfig } from "../services/config";
import { log } from "../services/logs";
import { eventStore, mailboxes$, tagged$ } from "../services/nostr";
import { sendNotification } from "../services/ntfy";

export const enabled$ = configValue("pubkey").pipe(map((pubkey) => !!pubkey));

log("Listening for replies");
tagged$.pipe(filter((event) => event.kind === 1)).subscribe(async (event) => {
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
