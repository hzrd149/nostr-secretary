import type { RouterTypes } from "bun";
import Document from "../components/Document";
import Layout from "../components/Layout";
import config$ from "../services/config";
import { normalizeToPubkey } from "applesauce-core/helpers";

export function ConfigView({ saved }: { saved?: boolean }) {
  const currentConfig = config$.getValue();

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
            <label for="pubkey">User Public Key</label>
            <div class="help-text">
              Your Nostr public key in hex format (64 characters)
            </div>
            <input
              type="text"
              id="pubkey"
              name="pubkey"
              value={currentConfig.pubkey || ""}
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

          <div class="form-group">
            <label for="appLink">App Link Template</label>
            <div class="help-text">
              Custom app link template for notification clicks. The{" "}
              <code>{"{link}"}</code> tag will be replaced with the NIP-19
              encoded nevent or naddr of the event.
            </div>
            <div style="display: flex; gap: 10px; align-items: flex-start;">
              <input
                type="text"
                id="appLink"
                name="appLink"
                value={currentConfig.appLink || "nostr:{link}"}
                placeholder="nostr:{link}"
                style="flex: 1;"
              />
              <select
                id="appLinkPresets"
                onchange="document.getElementById('appLink').value = this.value"
                style="min-width: 150px; flex-shrink: 0;"
              >
                <option value="">Select preset...</option>
                <option value="nostr:{link}">Native app</option>
                <option value="https://nostrudel.ninja/l/{link}">
                  noStrudel
                </option>
                <option value="https://coracle.social/notes/{link}">
                  Coracle
                </option>
                <option value="https://njump.me/{link}">njump</option>
              </select>
            </div>
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
      const pubkey = formData.get("pubkey") as string;
      const lookupRelaysText = formData.get("lookupRelays") as string;
      const ntfyServer = formData.get("ntfyServer") as string;
      const ntfyTopic = formData.get("ntfyTopic") as string;
      const email = formData.get("email") as string;
      const appLink = formData.get("appLink") as string;

      // Parse lookup relays from textarea (one per line)
      const lookupRelays = lookupRelaysText
        .split("\n")
        .map((relay) => relay.trim())
        .filter((relay) => relay.length > 0 && relay.startsWith("wss://"));

      // Update config
      const currentConfig = config$.getValue();
      const newConfig = {
        ...currentConfig,
        pubkey: normalizeToPubkey(pubkey.trim()),
        lookupRelays:
          lookupRelays.length > 0 ? lookupRelays : currentConfig.lookupRelays,
        server: ntfyServer.trim() || currentConfig.server,
        topic: ntfyTopic.trim().toLowerCase() || currentConfig.topic,
        email: email.trim() || currentConfig.email,
        appLink: appLink.trim() || currentConfig.appLink,
      };

      config$.next(newConfig);

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
