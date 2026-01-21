import {
  getAddressPointerForEvent,
  getEventPointerForEvent,
} from "applesauce-core/helpers";
import {
  encodeGroupPointer,
  type GroupPointer,
} from "applesauce-common/helpers";
import { nip19, type NostrEvent } from "nostr-tools";
import { isAddressableKind } from "nostr-tools/kinds";
import { naddrEncode, neventEncode } from "nostr-tools/nip19";
import config$, { getConfig } from "../services/config";
import { CACHI_GROUP_LINK } from "../const";

function addCommonTags(template: string, event: NostrEvent): string {
  const eventPointer = getEventPointerForEvent(event);
  const addressPointer = isAddressableKind(event.kind)
    ? getAddressPointerForEvent(event)
    : null;

  return template
    .replace("{nevent}", eventPointer ? neventEncode(eventPointer) : "")
    .replace("{pubkey}", event.pubkey)
    .replace("{naddr}", addressPointer ? naddrEncode(addressPointer) : "")
    .replace("{npub}", nip19.npubEncode(event.pubkey));
}

export function buildOpenLink(event: NostrEvent): string {
  const { appLink } = config$.getValue();
  const template = appLink || "nostr:{link}";

  let link = "";
  if (isAddressableKind(event.kind)) {
    const addressPointer = getAddressPointerForEvent(event);
    link = addressPointer ? nip19.naddrEncode(addressPointer) : "";
  } else {
    const eventPointer = getEventPointerForEvent(event);
    link = eventPointer ? nip19.neventEncode(eventPointer) : "";
  }

  return addCommonTags(template.replace("{link}", link), event);
}

export function buildGroupLink(
  group: GroupPointer,
  message: NostrEvent,
): string {
  const { groups } = getConfig();

  const template = groups.groupLink || CACHI_GROUP_LINK;
  return addCommonTags(
    template
      .replace("{relay}", group.relay)
      .replace("{hostname}", new URL(group.relay).hostname)
      .replace("{id}", group.id)
      .replace("{group}", encodeGroupPointer(group)),
    message,
  );
}
