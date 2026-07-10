import type { AppConfig } from "../services/config";
import type { DmCategory } from "./dm-category";

/**
 * Result of {@link evaluateDmNotificationGates}: either the notification
 * passes both gates, or it is blocked at a specific stage (used for the
 * distinct log messages in notifications/messages.ts).
 */
export type DmGateResult =
  | { pass: true }
  | { pass: false; reason: "category-disabled" }
  | { pass: false; reason: "not-whitelisted" };

/**
 * The D5-07 layered gate order, extracted verbatim from both DM listeners
 * in notifications/messages.ts so the real production ordering (category
 * gate BEFORE shouldNotify) has direct, importable test coverage instead of
 * only a hand-written mirror (WR-02): 1) the sender's category
 * (contacts/others) must be enabled, 2) `shouldNotify` (whitelist/blacklist/
 * mute gate) must pass.
 *
 * `shouldNotify` is injected rather than imported so this function has zero
 * dependency on services/nostr.ts's self-subscribing singletons -- it (and
 * this whole module) can be imported directly from a test file without
 * risking real network I/O (see tests/notifications/messages.test.ts's
 * top-of-file note on why it avoids importing notifications/messages.ts).
 */
export async function evaluateDmNotificationGates(
  category: DmCategory,
  messages: Pick<AppConfig["messages"], "contacts" | "others">,
  sender: string,
  shouldNotify: (pubkey: string) => Promise<boolean>,
): Promise<DmGateResult> {
  if (!messages[category].enabled)
    return { pass: false, reason: "category-disabled" };

  if (!(await shouldNotify(sender)))
    return { pass: false, reason: "not-whitelisted" };

  return { pass: true };
}
