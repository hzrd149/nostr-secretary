import { nip19, type NostrEvent } from "nostr-tools";
import config from "../services/config";
import { isAddressableKind } from "nostr-tools/kinds";
import {
  getAddressPointerForEvent,
  getEventPointerForEvent,
} from "applesauce-core/helpers";

export function buildOpenLink(event: NostrEvent): string {
  const { appLink } = config.getValue();

  const link = isAddressableKind(event.kind)
    ? nip19.naddrEncode(getAddressPointerForEvent(event))
    : nip19.neventEncode(getEventPointerForEvent(event));
  if (!appLink) return `nostr:${link}`;
  return appLink.replace("{link}", link);
}
