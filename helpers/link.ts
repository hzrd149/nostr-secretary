import {
  encodeGroupPointer,
  getAddressPointerForEvent,
  getEventPointerForEvent,
  type GroupPointer,
} from "applesauce-core/helpers";
import { nip19, type NostrEvent } from "nostr-tools";
import { isAddressableKind } from "nostr-tools/kinds";
import { naddrEncode, neventEncode } from "nostr-tools/nip19";
import config$, { getConfig } from "../services/config";
import { CACHI_GROUP_LINK } from "../const";

function addCommonTags(template: string, event: NostrEvent): string {
  return template
    .replace("{nevent}", neventEncode(getEventPointerForEvent(event)))
    .replace("{pubkey}", event.pubkey)
    .replace(
      "{naddr}",
      isAddressableKind(event.kind)
        ? naddrEncode(getAddressPointerForEvent(event))
        : "",
    )
    .replace("{npub}", nip19.npubEncode(event.pubkey));
}

export function buildOpenLink(event: NostrEvent): string {
  const { appLink } = config$.getValue();
  const template = appLink || "nostr:{link}";

  const link = isAddressableKind(event.kind)
    ? nip19.naddrEncode(getAddressPointerForEvent(event))
    : nip19.neventEncode(getEventPointerForEvent(event));

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
