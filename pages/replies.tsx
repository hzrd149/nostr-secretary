import type { RouterTypes } from "bun";
import Document from "../components/Document";
import Layout from "../components/Layout";
import WhitelistBlacklist from "../components/WhitelistBlacklist";
import config$ from "../services/config";
import { unique } from "../helpers/array";

export function RepliesConfigView({ saved }: { saved?: boolean }) {
  const currentConfig = config$.getValue();
  const repliesConfig = currentConfig.replies;

  return (
    <Document title="Reply Notifications">
      <Layout
        title="Reply Notifications"
        subtitle="Configure reply notification settings"
      >
        {saved && (
          <div id="successMessage" class="success-message">
            ✅ Reply configuration saved successfully!
          </div>
        )}

        <form action="/replies" method="POST">
          <div class="form-group">
            <div style="display: flex; align-items: flex-start; gap: 10px;">
              <input
                type="checkbox"
                id="enabled"
                name="enabled"
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
              onclick="window.location.href='/notifications'"
            >
              Back to Notifications
            </button>
            <button type="submit" class="btn-primary">
              Save Reply Settings
            </button>
          </div>
        </form>
      </Layout>
    </Document>
  );
}

const route: RouterTypes.RouteValue<"/replies"> = {
  GET: async () => {
    return new Response(await RepliesConfigView({}), {
      headers: { "Content-Type": "text/html" },
    });
  },
  POST: async (req) => {
    try {
      const formData = await req.formData();
      const enabled = formData.has("enabled");
      const whitelistsText = formData.get("whitelists") as string;
      const blacklistsText = formData.get("blacklists") as string;

      // Parse whitelists and blacklists from textarea (one per line)
      const whitelists = unique(
        whitelistsText
          .split("\n")
          .map((line) => line.trim())
          .filter((line) => line.length > 0),
      );

      const blacklists = unique(
        blacklistsText
          .split("\n")
          .map((line) => line.trim())
          .filter((line) => line.length > 0),
      );

      // Update config
      const currentConfig = config$.getValue();
      const newConfig = {
        ...currentConfig,
        replies: {
          enabled,
          whitelists,
          blacklists,
        },
      };

      config$.next(newConfig);

      // Redirect back to replies page with success
      return new Response(await RepliesConfigView({ saved: true }), {
        headers: { "Content-Type": "text/html" },
      });
    } catch (error) {
      return new Response("Invalid form data", { status: 400 });
    }
  },
};

export default route;
