import { getNip10References } from "applesauce-core/helpers/threading";
import { filter, firstValueFrom } from "rxjs";

import { getDisplayName, getProfilePicture } from "applesauce-core/helpers";
import { getConfig } from "../services/config";
import { log } from "../services/logs";
import { eventStore, tagged$ } from "../services/nostr";
import { sendNotification } from "../services/ntfy";

tagged$.pipe(filter((event) => event.kind === 1)).subscribe(async (event) => {
  const refs = getNip10References(event);
  if (!refs.reply?.e) return;

  // Get the event that was being replied to
  log("Fetching reply", { eventId: event.id, pointer: refs.reply.e });
  const reply = await firstValueFrom(eventStore.event(refs.reply.e));

  // Quit if parent event cant be found
  if (!reply)
    return log("Failed to find parent event", {
      eventId: event.id,
      pointer: refs.reply.e,
    });

  const { pubkey } = getConfig();
  if (reply.pubkey !== pubkey) return;

  // Get the profile of the user who replied
  const profile = await firstValueFrom(eventStore.profile(reply.pubkey));

  // Send a notification
  await sendNotification({
    title: `${getDisplayName(profile)} replied to your post`,
    message: reply.content,
    icon: getProfilePicture(profile),
  });
});
