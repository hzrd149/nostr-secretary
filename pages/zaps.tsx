import type { RouterTypes } from "bun";
import Document from "../components/Document";
import Layout from "../components/Layout";
import WhitelistBlacklist from "../components/WhitelistBlacklist";
import config$ from "../services/config";
import { unique } from "../helpers/array";

export function ZapsConfigView({ saved }: { saved?: boolean }) {
  const currentConfig = config$.getValue();
  const zapsConfig = currentConfig.zaps;

  return (
    <Document title="Zap Notifications">
      <Layout
        title="Zap Notifications"
        subtitle="Configure Lightning Network zap notification settings"
      >
        {saved && (
          <div id="successMessage" class="success-message">
            ✅ Zap configuration saved successfully!
          </div>
        )}

        <form action="/zaps" method="POST">
          <div class="form-group">
            <div style="display: flex; align-items: flex-start; gap: 10px;">
              <input
                type="checkbox"
                id="enabled"
                name="enabled"
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
              onclick="window.location.href='/notifications'"
            >
              Back to Notifications
            </button>
            <button type="submit" class="btn-primary">
              Save Zap Settings
            </button>
          </div>
        </form>
      </Layout>
    </Document>
  );
}

const route: RouterTypes.RouteValue<"/zaps"> = {
  GET: async () => {
    return new Response(await ZapsConfigView({}), {
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
        zaps: {
          enabled,
          whitelists,
          blacklists,
        },
      };

      config$.next(newConfig);

      // Redirect back to zaps page with success
      return new Response(await ZapsConfigView({ saved: true }), {
        headers: { "Content-Type": "text/html" },
      });
    } catch (error) {
      return new Response("Invalid form data", { status: 400 });
    }
  },
};

export default route;
