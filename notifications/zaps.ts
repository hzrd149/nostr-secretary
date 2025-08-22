import { defined } from "applesauce-core";
import {
  getDisplayName,
  getProfilePicture,
  getZapAddressPointer,
  getZapEventPointer,
  getZapPayment,
  getZapRequest,
  getZapSender,
} from "applesauce-core/helpers";
import { kinds } from "nostr-tools";
import { filter, firstValueFrom, map, NEVER, of, switchMap } from "rxjs";
import { buildOpenLink } from "../helpers/link";
import { loadLists } from "../helpers/lists";
import config$, { getConfig } from "../services/config";
import { log } from "../services/logs";
import { blacklist$, eventStore, tagged$, whitelist$ } from "../services/nostr";
import { sendNotification } from "../services/ntfy";

/** Check if a sender should receive notifications based on whitelist/blacklist */
async function shouldNotify(pubkey: string): Promise<boolean> {
  const { zaps } = getConfig();

  // If there are blacklists, check if sender is blacklisted
  if (zaps.blacklists.length > 0) {
    const blacklistedPubkeys = await loadLists(zaps.blacklists);
    if (blacklistedPubkeys.includes(pubkey)) return false;
  }

  // If there are whitelists, only allow whitelisted senders
  if (zaps.whitelists.length > 0) {
    const whitelistedPubkeys = await loadLists(zaps.whitelists);
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

export const enabled$ = config$.pipe(map((c) => c.zaps.enabled));

log("Listening for zaps");
enabled$
  .pipe(
    switchMap((enabled) =>
      enabled
        ? tagged$.pipe(filter((event) => event.kind === kinds.Zap))
        : NEVER,
    ),
  )
  .subscribe(async (zap) => {
    const eventPointer = getZapEventPointer(zap);
    const addressPointer = getZapAddressPointer(zap);

    // Load the event that was zapped
    const event = await firstValueFrom(
      eventPointer
        ? eventStore.event(eventPointer)
        : addressPointer
          ? eventStore.addressable(addressPointer)
          : of(null),
    );

    if (!event)
      return log("Failed to find zap event or addressable", {
        zap: zap.id,
        eventPointer,
        addressPointer,
      });

    const { pubkey } = getConfig();
    if (event.pubkey !== pubkey) return;

    const payment = getZapPayment(zap);
    const sender = getZapSender(zap);

    // Check if we should notify for this sender
    if (!(await shouldNotify(sender)))
      return log(
        "Skipping zap notification for blacklisted/non-whitelisted sender",
        { sender },
      );

    const profile = await firstValueFrom(
      eventStore.profile(sender).pipe(defined()),
    );

    if (!payment?.amount) return log("Zap has no amount", { zap: zap.id });

    await sendNotification({
      title: "Zap Received",
      message: `${getDisplayName(profile)} zapped you ${payment?.amount / 1000} sats`,
      icon: getProfilePicture(profile),
      click: buildOpenLink(event),
    });
  });
