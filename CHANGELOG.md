# Changelog

## Unreleased

- Add per-group NIP-29 notification modes: each joined group can be set to All messages, Only @mentions, or Muted from the /groups page.
- **Behavior change:** groups now default to Only @mentions instead of All messages. If you previously received every message from your groups, you will start receiving only messages that @mention you until you switch a group back to "All messages" on the /groups page.

## 0.3.2

- Authenticate to NIP-29 group relays via NIP-42.

## 0.3.1

- Filter notifications by the user's mute list.

## 0.3.0

- Migrate to applesauce v6 (`applesauce-core`, `applesauce-common`, `applesauce-loaders`, `applesauce-relay`, `applesauce-accounts`, `applesauce-signers`).
- Remove unused `applesauce-content` dependency.
- Add `resubscribe: true` to all relay and group subscriptions so they re-open after a clean `CLOSED` message from the relay (v6 no longer errors on `CLOSED`). Combined with `reconnect: Infinity`, subscriptions now stay connected indefinitely.
