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
import { filter, firstValueFrom, of } from "rxjs";
import { getConfig } from "../services/config";
import { log } from "../services/logs";
import { eventStore, tagged$ } from "../services/nostr";
import { sendNotification } from "../services/ntfy";

tagged$
  .pipe(filter((event) => event.kind === kinds.Zap))
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
    const request = getZapRequest(zap);

    const sender = getZapSender(zap);
    const profile = await firstValueFrom(
      eventStore.profile(sender).pipe(defined()),
    );

    if (!payment?.amount) return log("Zap has no amount", { zap: zap.id });

    await sendNotification({
      title: "Zap Received",
      message: `${getDisplayName(profile)} zapped you ${payment?.amount / 1000} sats`,
      icon: getProfilePicture(profile),
    });
  });
