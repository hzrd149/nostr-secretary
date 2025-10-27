import { ServerSentEventGenerator } from "@starfederation/datastar-sdk/web";
import type { BunRequest } from "bun";
import Document from "../components/Document";
import Layout from "../components/Layout";
import WhitelistBlacklist from "../components/WhitelistBlacklist";
import config$ from "../services/config";
import { unique } from "../helpers/array";

export function RepliesConfigView() {
  const currentConfig = config$.getValue();
  const repliesConfig = currentConfig.replies;

  return (
    <Document title="Reply Notifications">
      <Layout
        title="Reply Notifications"
        subtitle="Configure reply notification settings"
      >
        <div class="success-message" data-show="$saved">
          ✅ Reply configuration saved successfully!
        </div>

        <div
          class="error-message"
          data-show="$error"
          style="margin-bottom: 20px; padding: 10px; background-color: #f8d7da; border: 1px solid #f5c6cb; border-radius: 4px; color: #721c24;"
        >
          ❌ <span data-text="$error"></span>
        </div>
        <div class="form-group">
          <div style="display: flex; align-items: flex-start; gap: 10px;">
            <input
              type="checkbox"
              id="enabled"
              data-bind="enabled"
              checked={repliesConfig.enabled}
              style="margin-top: 4px; width: 20px; height: 20px;"
            />
            <div style="flex: 1;">
              <label
                for="enabled"
                style="font-weight: bold; margin-bottom: 8px; display: block;"
              >
                Enable Reply Notifications
              </label>
              <div class="help-text">
                Receive notifications when someone replies to your notes on
                Nostr.
              </div>
            </div>
          </div>
        </div>

        <WhitelistBlacklist
          whitelists={repliesConfig.whitelists}
          blacklists={repliesConfig.blacklists}
          pubkey={currentConfig.pubkey}
        />

        <div class="button-group">
          <button
            type="button"
            class="btn-secondary"
            data-on-click="window.location.href='/notifications'"
          >
            Back to Notifications
          </button>
          <button
            class="btn-primary"
            data-on-click="@patch(location.href)"
            data-indicator-saving
            data-attr-disabled="$saving"
          >
            Save Reply Settings
          </button>
        </div>
      </Layout>
    </Document>
  );
}

const route = {
  GET: async () => {
    return new Response(await RepliesConfigView(), {
      headers: { "Content-Type": "text/html" },
    });
  },
  PATCH: async (req: BunRequest) => {
    const reader = await ServerSentEventGenerator.readSignals(req);
    if (!reader.success) throw new Error(reader.error);

    return ServerSentEventGenerator.stream(async (stream) => {
      const { signals } = reader;
      const enabled = signals.enabled as boolean;
      const whitelistsText = signals.whitelists as string;
      const blacklistsText = signals.blacklists as string;

      try {
        // Parse whitelists and blacklists from textarea (one per line)
        const whitelists = unique(
          whitelistsText
            ?.split("\n")
            .map((line) => line.trim())
            .filter((line) => line.length > 0) || [],
        );

        const blacklists = unique(
          blacklistsText
            ?.split("\n")
            .map((line) => line.trim())
            .filter((line) => line.length > 0) || [],
        );

        // Update config
        const currentConfig = config$.getValue();
        const newConfig = {
          ...currentConfig,
          replies: {
            enabled: !!enabled,
            whitelists,
            blacklists,
          },
        };

        config$.next(newConfig);

        // Signal success
        stream.patchSignals(JSON.stringify({ saved: true }));
      } catch (error) {
        stream.patchSignals(
          JSON.stringify({
            error:
              error instanceof Error
                ? error.message
                : "An unknown error occurred",
          }),
        );
      }
    });
  },
};

export default route;
