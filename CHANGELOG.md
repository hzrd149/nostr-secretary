# Changelog

## 0.3.0

- Migrate to applesauce v6 (`applesauce-core`, `applesauce-common`, `applesauce-loaders`, `applesauce-relay`, `applesauce-accounts`, `applesauce-signers`).
- Remove unused `applesauce-content` dependency.
- Add `resubscribe: true` to all relay and group subscriptions so they re-open after a clean `CLOSED` message from the relay (v6 no longer errors on `CLOSED`). Combined with `reconnect: Infinity`, subscriptions now stay connected indefinitely.
