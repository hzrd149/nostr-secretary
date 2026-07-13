# Changelog

## Unreleased

- Add per-group NIP-29 notification modes: each joined group can be set to All messages, Only @mentions, or Muted from the /groups page.
- **Behavior change:** groups now default to Only @mentions instead of All messages. If you previously received every message from your groups, you will start receiving only messages that @mention you until you switch a group back to "All messages" on the /groups page.
- Add outbound-notification rate limiting: a global cap and a per-type cap (replies/zaps/messages/groups) over a shared 60-second window, with overflow accumulated into a single combined summary notification instead of being dropped.
- **Behavior change:** new default anti-spam rate limits apply automatically (5 notifications/min per type, 20/min globally). Set any limit to `0` to disable it (unlimited) for that type or globally.
- Add default per-context rate limits: a cap of 3 notifications/min from any single NIP-29 group and 5/min from any single DM conversation, applied automatically to newly-joined groups and new DM conversations, layered on top of the existing per-type and global limits (most-restrictive-wins).
- **Behavior change:** a very chatty single group or DM conversation may now be throttled more than before even if your per-type/global totals are unchanged, since it also has its own per-group/per-DM cap. Set the per-group or per-DM limit to `0` to disable per-context throttling (unlimited) for that context.

## 0.3.2

- Authenticate to NIP-29 group relays via NIP-42.

## 0.3.1

- Filter notifications by the user's mute list.

## 0.3.0

- Migrate to applesauce v6 (`applesauce-core`, `applesauce-common`, `applesauce-loaders`, `applesauce-relay`, `applesauce-accounts`, `applesauce-signers`).
- Remove unused `applesauce-content` dependency.
- Add `resubscribe: true` to all relay and group subscriptions so they re-open after a clean `CLOSED` message from the relay (v6 no longer errors on `CLOSED`). Combined with `reconnect: Infinity`, subscriptions now stay connected indefinitely.
