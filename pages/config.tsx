import type { RouterTypes } from "bun";
import Document from "../components/Document";
import Layout from "../components/Layout";
import config from "../services/config";
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

          <div class="form-group">
            <label for="ntfyServer">Ntfy Server (Optional)</label>
            <div class="help-text">
              The ntfy server URL to use for notifications. Defaults to ntfy.sh
              if not set.
            </div>
            <input
              type="url"
              id="ntfyServer"
              name="ntfyServer"
              value={currentConfig.server || ""}
              placeholder="https://ntfy.sh (default)"
            />
          </div>

          <div class="form-group">
            <label for="ntfyTopic">Ntfy Topic</label>
            <div class="help-text">
              The topic name for your ntfy.sh notifications.
            </div>
            <div
              class="warning-text"
              style="margin-bottom: 10px; padding: 10px; background-color: #fff3cd; border: 1px solid #ffeaa7; border-radius: 4px; color: #856404;"
            >
              ⚠️ <strong>Security Warning:</strong> Use a random, unique topic
              ID. If you use a predictable topic name, other users might be able
              to subscribe to your notification channel and see your private
              notifications.
            </div>
            <input
              type="text"
              id="ntfyTopic"
              name="ntfyTopic"
              value={currentConfig.topic || ""}
              placeholder="Enter a random topic ID..."
              pattern="[a-zA-Z0-9_-]+"
              title="Topic should contain only letters, numbers, underscores, and hyphens"
            />
          </div>

          <div class="form-group">
            <label for="email">Email Address (Optional)</label>
            <div class="help-text">
              Fallback email address to receive notifications when you don't
              have the ntfy app available.
            </div>
            <input
              type="email"
              id="email"
              name="email"
              value={currentConfig.email || ""}
              placeholder="your.email@example.com"
            />
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
      const ntfyServer = formData.get("ntfyServer") as string;
      const ntfyTopic = formData.get("ntfyTopic") as string;
      const email = formData.get("email") as string;

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
        server: ntfyServer.trim() || config.getValue().server,
        topic: ntfyTopic.trim() || config.getValue().topic,
        email: email.trim() || config.getValue().email,
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
