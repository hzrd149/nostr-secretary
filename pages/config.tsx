import type { RouterTypes } from "bun";
import Document from "../components/Document";
import Layout from "../components/Layout";
import config from "../config";
import { normalizeToPubkey } from "applesauce-core/helpers";

export function ConfigView({ saved }: { saved?: boolean }) {
  const currentConfig = config.getValue();

  return (
    <Document title="Configuration">
      <Layout
        title="Configuration"
        subtitle="Configure your Nostr Secretary settings"
      >
        {saved && (
          <div id="successMessage" class="success-message">
            ✅ Configuration saved successfully!
          </div>
        )}

        <form action="/config" method="POST">
          <div class="form-group">
            <label for="user">User Public Key</label>
            <div class="help-text">
              Your Nostr public key in hex format (64 characters)
            </div>
            <input
              type="text"
              id="user"
              name="user"
              value={currentConfig.user || ""}
              placeholder="Enter your hex public key..."
              pattern="[a-fA-F0-9]{64}"
              title="Public key must be 64 hex characters"
            />
          </div>

          <div class="form-group">
            <label for="lookupRelays">Lookup Relays</label>
            <div class="help-text">
              One relay URL per line. These relays will be used to look up
              profiles and mailboxes.
            </div>
            <textarea
              id="lookupRelays"
              name="lookupRelays"
              placeholder="wss://relay.example.com&#10;wss://another-relay.com"
              safe
            >
              {currentConfig.lookupRelays.join("\n")}
            </textarea>
          </div>

          <div class="button-group">
            <button
              type="button"
              class="btn-secondary"
              onclick="window.location.href='/'"
            >
              Cancel
            </button>
            <button type="submit" class="btn-primary">
              Save Configuration
            </button>
          </div>
        </form>

        <a href="/" class="nav-link">
          ← Back to Home
        </a>
      </Layout>
    </Document>
  );
}

const route: RouterTypes.RouteValue<"/config"> = {
  GET: async () => {
    return new Response(await ConfigView({}), {
      headers: { "Content-Type": "text/html" },
    });
  },
  POST: async (req) => {
    try {
      const formData = await req.formData();
      const user = formData.get("user") as string;
      const lookupRelaysText = formData.get("lookupRelays") as string;

      // Parse lookup relays from textarea (one per line)
      const lookupRelays = lookupRelaysText
        .split("\n")
        .map((relay) => relay.trim())
        .filter((relay) => relay.length > 0 && relay.startsWith("wss://"));

      // Update config
      const newConfig = {
        user: normalizeToPubkey(user.trim()),
        lookupRelays:
          lookupRelays.length > 0
            ? lookupRelays
            : config.getValue().lookupRelays,
      };

      config.next(newConfig);

      // Redirect back to config page with success
      return new Response(await ConfigView({ saved: true }), {
        headers: { "Content-Type": "text/html" },
      });
    } catch (error) {
      return new Response("Invalid form data", { status: 400 });
    }
  },
};

export default route;
