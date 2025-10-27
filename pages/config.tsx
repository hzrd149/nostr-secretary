import { ServerSentEventGenerator } from "@starfederation/datastar-sdk/web";
import { normalizeToPubkey } from "applesauce-core/helpers";
import type { BunRequest } from "bun";

import Document from "../components/Document";
import Layout from "../components/Layout";
import config$ from "../services/config";

export function ConfigView() {
  const currentConfig = config$.getValue();

  return (
    <Document title="Configuration">
      <Layout
        title="Configuration"
        subtitle="Configure your Nostr Secretary settings"
      >
        <div id="successMessage" class="success-message" data-show="$saved">
          ✅ Configuration saved successfully!
        </div>

        <div
          class="error-message"
          data-show="$error"
          style="margin-bottom: 20px; padding: 10px; background-color: #f8d7da; border: 1px solid #f5c6cb; border-radius: 4px; color: #721c24;"
        >
          ❌ <span data-text="$error"></span>
        </div>

        <div class="form-group">
          <label for="pubkey">User Public Key</label>
          <div class="help-text">
            Your Nostr public key in either npub format (starts with 'npub1') or
            hex format (64 characters)
          </div>
          <input
            type="text"
            id="pubkey"
            data-bind-pubkey
            value={currentConfig.pubkey || ""}
            placeholder="npub1... or hex public key..."
            title="Public key in npub or hex format"
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
            data-bind="lookupRelays"
            placeholder="wss://relay.example.com&#10;wss://another-relay.com"
            safe
          >
            {currentConfig.lookupRelays.join("\n")}
          </textarea>
        </div>

        <div class="form-group">
          <label for="ntfyServer">Ntfy Server (Optional)</label>
          <div class="help-text">
            The ntfy server URL to use for notifications. Defaults to ntfy.sh if
            not set.
          </div>
          <input
            type="url"
            id="ntfyServer"
            data-bind="ntfyServer"
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
            ⚠️ <strong>Security Warning:</strong> Use a random, unique topic ID.
            If you use a predictable topic name, other users might be able to
            subscribe to your notification channel and see your private
            notifications.
          </div>
          <input
            type="text"
            id="ntfyTopic"
            data-bind="ntfyTopic"
            value={currentConfig.topic || ""}
            placeholder="Enter a random topic ID..."
            pattern="[a-zA-Z0-9_-]+"
            title="Topic should contain only letters, numbers, underscores, and hyphens"
          />
        </div>

        <div class="form-group">
          <label for="email">Email Address (Optional)</label>
          <div class="help-text">
            Fallback email address to receive notifications when you don't have
            the ntfy app available.
          </div>
          <input
            type="email"
            id="email"
            data-bind-email
            value={currentConfig.email || ""}
            placeholder="your.email@example.com"
          />
        </div>

        <div class="form-group">
          <label for="appLink">App Link Template</label>
          <div class="help-text">
            Custom app link template for notification clicks. The{" "}
            <code>{"{link}"}</code> tag will be replaced with the NIP-19 encoded
            nevent or naddr of the event.
          </div>
          <div style="display: flex; gap: 10px; align-items: flex-start;">
            <input
              type="text"
              data-bind="appLink"
              value={currentConfig.appLink || "nostr:{link}"}
              placeholder="nostr:{link}"
              style="flex: 1;"
            />
            <select
              data-on-change="$appLink = el.value"
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
            data-on-click="window.location.href='/'"
          >
            Cancel
          </button>
          <button class="btn-primary" data-on-click="@patch(location.href)">
            Save Configuration
          </button>
        </div>
      </Layout>
    </Document>
  );
}

const route = {
  GET: async () => {
    return new Response(await ConfigView(), {
      headers: { "Content-Type": "text/html" },
    });
  },
  PATCH: async (req: BunRequest) => {
    const reader = await ServerSentEventGenerator.readSignals(req);
    if (!reader.success) throw new Error(reader.error);

    return ServerSentEventGenerator.stream(async (stream) => {
      const { signals } = reader;
      const pubkey = signals.pubkey as string;
      const lookupRelaysText = signals.lookupRelays as string;
      const ntfyServer = signals.ntfyServer as string;
      const ntfyTopic = signals.ntfyTopic as string;
      const email = signals.email as string;
      const appLink = signals.appLink as string;

      try {
        // Validate and normalize pubkey
        const trimmedPubkey = pubkey.trim();
        if (!trimmedPubkey) throw new Error("Public key is required");

        const normalizedPubkey = normalizeToPubkey(trimmedPubkey);
        if (!normalizedPubkey)
          throw new Error(
            "Invalid public key format. Please enter a valid npub (starts with 'npub1') or 64-character hex key.",
          );

        // Parse lookup relays from textarea (one per line)
        const lookupRelays = lookupRelaysText
          .split("\n")
          .map((relay) => relay.trim())
          .filter((relay) => relay.length > 0 && relay.startsWith("wss://"));

        // Update config
        const currentConfig = config$.getValue();
        currentConfig;
        const newConfig = {
          ...currentConfig,
          pubkey: normalizedPubkey,
          lookupRelays:
            lookupRelays.length > 0 ? lookupRelays : currentConfig.lookupRelays,
          server: ntfyServer.trim() || currentConfig.server,
          topic: ntfyTopic.trim().toLowerCase() || currentConfig.topic,
          email: email.trim() || currentConfig.email,
          appLink: appLink.trim() || currentConfig.appLink,
        };

        config$.next(newConfig);

        // Redirect back to config page with success
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
