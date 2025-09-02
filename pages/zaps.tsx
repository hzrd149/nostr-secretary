import { ServerSentEventGenerator } from "@starfederation/datastar-sdk/web";
import type { RouterTypes } from "bun";
import Document from "../components/Document";
import Layout from "../components/Layout";
import WhitelistBlacklist from "../components/WhitelistBlacklist";
import config$ from "../services/config";
import { unique } from "../helpers/array";

export function ZapsConfigView() {
  const currentConfig = config$.getValue();
  const zapsConfig = currentConfig.zaps;

  return (
    <Document title="Zap Notifications">
      <Layout
        title="Zap Notifications"
        subtitle="Configure Lightning Network zap notification settings"
      >
        <div class="success-message" data-show="$saved">
          ✅ Zap configuration saved successfully!
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
              checked={zapsConfig.enabled}
              style="margin-top: 4px; width: 20px; height: 20px;"
            />
            <div style="flex: 1;">
              <label
                for="enabled"
                style="font-weight: bold; margin-bottom: 8px; display: block;"
              >
                Enable Zap Notifications
              </label>
              <div class="help-text">
                Receive notifications when someone zaps (tips with Lightning
                Network) your notes or profile on Nostr.
              </div>
            </div>
          </div>
        </div>

        <WhitelistBlacklist
          whitelists={zapsConfig.whitelists}
          blacklists={zapsConfig.blacklists}
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
            Save Zap Settings
          </button>
        </div>
      </Layout>
    </Document>
  );
}

const route: RouterTypes.RouteValue<"/zaps"> = {
  GET: async () => {
    return new Response(await ZapsConfigView(), {
      headers: { "Content-Type": "text/html" },
    });
  },
  PATCH: async (req) => {
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
          zaps: {
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
