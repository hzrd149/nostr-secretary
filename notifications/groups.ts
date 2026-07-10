import { defined } from "applesauce-core";
import {
  getDisplayName,
  getProfilePicture,
  getTagValue,
} from "applesauce-core/helpers";
import {
  encodeGroupPointer,
  getGroupPointerFromGroupTag,
  GROUP_MESSAGE_KIND,
  type GroupPointer,
} from "applesauce-common/helpers";
import { onlyEvents } from "applesauce-relay";
import {
  catchError,
  combineLatest,
  EMPTY,
  firstValueFrom,
  map,
  merge,
  NEVER,
  of,
  switchMap,
} from "rxjs";
import { getGroupMode, passesGroupModeGate } from "../helpers/groups";
import { buildGroupLink } from "../helpers/link";
import { loadLists } from "../helpers/lists";
import config$, { getConfig } from "../services/config";
import { log } from "../services/logs";
import {
  blacklist$,
  eventStore,
  groups$,
  isMuted,
  pool,
  whitelist$,
} from "../services/nostr";
import { rateLimitedNotify } from "../services/rate-limit";

/** Check if a sender should receive notifications based on whitelist/blacklist */
async function shouldNotify(pubkey: string): Promise<boolean> {
  const { groups } = getConfig();

  // Never notify for pubkeys the user has muted (NIP-51 kind 10000)
  if (await isMuted(pubkey)) return false;

  // If there are blacklists, check if sender is blacklisted
  if (groups.blacklists.length > 0) {
    const blacklistedPubkeys = await loadLists(groups.blacklists);
    if (blacklistedPubkeys.includes(pubkey)) return false;
  }

  // If there are whitelists, only allow whitelisted senders
  if (groups.whitelists.length > 0) {
    const whitelistedPubkeys = await loadLists(groups.whitelists);
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

function subscribeToGroup(group: GroupPointer) {
  // Subscribe to the group
  const metadata = pool
    .relay(group.relay)
    .request({ kinds: [39000], limit: 1, "#d": [group.id] });

  const message = pool
    .relay(group.relay)
    .subscription(
      { kinds: [GROUP_MESSAGE_KIND], limit: 1, "#d": [group.id] },
      { reconnect: Infinity, resubscribe: true },
    )
    .pipe(onlyEvents());

  log("Listening for group messages", { group: encodeGroupPointer(group) });

  return combineLatest({ group: of(group), metadata, message }).pipe(
    catchError((err) => {
      log("Error subscribing to group", {
        group: encodeGroupPointer(group),
        error: String(err),
      });
      return EMPTY;
    }),
  );
}

export const enabled$ = combineLatest([config$, groups$]).pipe(
  map(([c, groups]) => c.groups.enabled && !!groups),
);

enabled$
  .pipe(
    switchMap((enabled) =>
      // If enabled subscribe to groups
      enabled
        ? groups$.pipe(
            defined(),
            map((list) =>
              list.tags
                .filter((t) => t[0] === "group" && t[1])
                .map(getGroupPointerFromGroupTag),
            ),
            switchMap((groups) => merge(...groups.map(subscribeToGroup))),
          )
        : NEVER,
    ),
  )
  .subscribe(async ({ group, metadata, message }) => {
    const { groups, pubkey } = getConfig();
    if (!pubkey) return;

    // Per-group mode gate (D-01/D-06/D-09 step 2)
    const mode = getGroupMode(groups.modes, group);
    if (!passesGroupModeGate(mode, message, pubkey))
      return log("Skipping group notification: muted or non-matching mode", {
        group: encodeGroupPointer(group),
        mode,
      });

    if (!(await shouldNotify(message.pubkey)))
      return log(
        "Skipping reply notification for blacklisted/non-whitelisted sender",
        { sender: message.pubkey },
      );

    // Get the profile of the user who replied
    const profile = await firstValueFrom(
      eventStore.profile(message.pubkey).pipe(defined()),
    );

    // Send a notification
    await rateLimitedNotify("groups", {
      title: `${getDisplayName(profile)} posted to ${getTagValue(metadata, "name")}`,
      message: message.content,
      icon: getTagValue(metadata, "picture") ?? getProfilePicture(profile),
      click: buildGroupLink(group, message),
    });
  });
