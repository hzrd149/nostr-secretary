import type { RouterTypes } from "bun";
import Document from "../components/Document";
import config$ from "../services/config";
import { normalizeToPubkey } from "applesauce-core/helpers";
import { firstValueFrom } from "rxjs";
import { mailboxes$, messageInboxes$, pool } from "../services/nostr";
import * as repliesNotification from "../notifications/replies";
import * as zapsNotification from "../notifications/zaps";
import * as messagesNotification from "../notifications/messages";

const styles = `
.home-container {
  text-align: center;
  background: white;
  padding: 3rem;
  border-radius: 12px;
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.1);
  max-width: 500px;
  width: 100%;
  margin: 0 auto;
  margin-top: 50vh;
  transform: translateY(-50%);
}

.home-container h1 {
  font-size: 2.5rem;
  color: #2d3748;
  margin-bottom: 1rem;
}

.home-container p {
  color: #718096;
  font-size: 1.1rem;
  margin-bottom: 2rem;
}

.status-summary {
  margin: 1rem 0;
  text-align: left;
}

.status-grid {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  margin-bottom: 1rem;
}

.status-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.75rem;
  background: white;
  border-radius: 6px;
  border: 1px solid #dee2e6;
}

.status-label {
  font-weight: 500;
  color: #495057;
  font-size: 0.9rem;
}

.status-value {
  font-weight: 600;
  font-size: 0.9rem;
}

.status-value.connected {
  color: #28a745;
}

.status-value.disconnected {
  color: #dc3545;
}

.status-value.enabled {
  color: #28a745;
}

.status-value.disabled {
  color: #6c757d;
}


`;

async function RelayStatusItem() {
  try {
    const mailboxes = await firstValueFrom(mailboxes$);
    const messageInboxes = await firstValueFrom(messageInboxes$);

    // Count total relays (unique URLs from inbox and DM relays)
    const allRelayUrls = new Set();
    if (mailboxes?.inboxes) {
      mailboxes.inboxes.forEach((url) => allRelayUrls.add(url));
    }
    if (messageInboxes) {
      messageInboxes.forEach((url) => allRelayUrls.add(url));
    }

    const totalRelays = allRelayUrls.size;
    let connectedRelays = 0;

    // Check connection status for each relay
    allRelayUrls.forEach((url) => {
      const relay = pool.relay(url as string);
      if (relay?.connected) {
        connectedRelays++;
      }
    });

    const relayStatus =
      connectedRelays === totalRelays && totalRelays > 0
        ? "connected"
        : "disconnected";

    return (
      <div class="status-item">
        <span class="status-label">Relays</span>
        <span class={`status-value ${relayStatus}`}>
          {connectedRelays}/{totalRelays}
        </span>
      </div>
    );
  } catch (error) {
    return (
      <div class="status-item">
        <span class="status-label">Relays</span>
        <span class="status-value disconnected">0/0</span>
      </div>
    );
  }
}

async function RepliesStatusItem() {
  try {
    const enabled = await firstValueFrom(repliesNotification.enabled$);
    return (
      <div class="status-item">
        <span class="status-label">Replies</span>
        <span class={`status-value ${enabled ? "enabled" : "disabled"}`}>
          {enabled ? "Enabled" : "Disabled"}
        </span>
      </div>
    );
  } catch (error) {
    return (
      <div class="status-item">
        <span class="status-label">Replies</span>
        <span class="status-value disabled">Disabled</span>
      </div>
    );
  }
}

async function ZapsStatusItem() {
  try {
    const enabled = await firstValueFrom(zapsNotification.enabled$);
    return (
      <div class="status-item">
        <span class="status-label">Zaps</span>
        <span class={`status-value ${enabled ? "enabled" : "disabled"}`}>
          {enabled ? "Enabled" : "Disabled"}
        </span>
      </div>
    );
  } catch (error) {
    return (
      <div class="status-item">
        <span class="status-label">Zaps</span>
        <span class="status-value disabled">Disabled</span>
      </div>
    );
  }
}

async function MessagesStatusItem() {
  try {
    const enabled = await firstValueFrom(messagesNotification.enabled$);
    return (
      <div class="status-item">
        <span class="status-label">Messages</span>
        <span class={`status-value ${enabled ? "enabled" : "disabled"}`}>
          {enabled ? "Enabled" : "Disabled"}
        </span>
      </div>
    );
  } catch (error) {
    return (
      <div class="status-item">
        <span class="status-label">Messages</span>
        <span class="status-value disabled">Disabled</span>
      </div>
    );
  }
}

async function StatusSummary() {
  return (
    <div class="status-summary">
      <div class="status-grid">
        <RelayStatusItem />
        <RepliesStatusItem />
        <ZapsStatusItem />
        <MessagesStatusItem />
      </div>
    </div>
  );
}

function NpubFormComponent({ error }: { error?: string }) {
  return (
    <>
      <p>Welcome! Please enter your Nostr npub to get started.</p>

      {error && (
        <div
          class="error-message"
          style="color: red; margin: 10px 0; padding: 10px; border: 1px solid red; border-radius: 4px; background-color: #ffe6e6;"
        >
          {error}
        </div>
      )}

      <form method="POST" action="/" class="npub-form" style="margin: 20px 0;">
        <div style="margin-bottom: 15px;">
          <label
            for="npub"
            style="display: block; margin-bottom: 5px; font-weight: bold;"
          >
            Your Nostr npub:
          </label>
          <input
            type="text"
            id="npub"
            name="npub"
            placeholder="npub1..."
            required
            style="width: 100%; max-width: 500px; padding: 8px; border: 1px solid #ccc; border-radius: 4px; font-family: monospace;"
          />
          <small style="display: block; margin-top: 5px; color: #666;">
            Your npub starts with "npub1" and can be found in your Nostr client
            settings.
          </small>
        </div>
        <button
          type="submit"
          style="background-color: #007bff; color: white; padding: 10px 20px; border: none; border-radius: 4px; cursor: pointer; font-size: 16px;"
        >
          Save Configuration
        </button>
      </form>
    </>
  );
}

export function HomeView({
  showNpubForm = false,
  error = "",
}: {
  showNpubForm?: boolean;
  error?: string;
} = {}) {
  return (
    <Document title="Nostr Secretary">
      <style>{styles}</style>
      <div class="home-container">
        <h1>Nostr Secretary</h1>

        {showNpubForm ? (
          <NpubFormComponent error={error} />
        ) : (
          <>
            <p>Your personal Nostr notifications</p>
            <StatusSummary />
            <div class="nav-links" style="flex-direction: column;">
              <a href="/status" class="nav-link">
                Status
              </a>
              <a href="/config" class="nav-link">
                Configuration
              </a>
              <a href="/notifications" class="nav-link">
                Notifications
              </a>
              <a href="/mobile" class="nav-link">
                Mobile Setup
              </a>
              <a href="/signer" class="nav-link">
                Signer
              </a>
            </div>
          </>
        )}
      </div>
    </Document>
  );
}

const route: RouterTypes.RouteValue<"/"> = {
  GET: async () => {
    const currentConfig = config$.getValue();
    const showNpubForm = !currentConfig.pubkey;

    return new Response(await HomeView({ showNpubForm }), {
      headers: { "Content-Type": "text/html" },
    });
  },

  POST: async (req) => {
    try {
      const formData = await req.formData();
      const npub = formData.get("npub")?.toString()?.trim();

      if (!npub) {
        return new Response(
          await HomeView({
            showNpubForm: true,
            error: "Please enter your npub",
          }),
          {
            headers: { "Content-Type": "text/html" },
            status: 400,
          },
        );
      }

      const hexPubkey = normalizeToPubkey(npub);
      if (!hexPubkey) {
        return new Response(
          await HomeView({
            showNpubForm: true,
            error:
              "Invalid npub format. Please make sure it starts with 'npub1'",
          }),
          {
            headers: { "Content-Type": "text/html" },
            status: 400,
          },
        );
      }

      // Update config with the new pubkey
      const currentConfig = config$.getValue();
      config$.next({ ...currentConfig, pubkey: hexPubkey });

      // Redirect to home page (GET request) to show the main interface
      return new Response("", {
        status: 302,
        headers: { Location: "/" },
      });
    } catch (error) {
      console.error("Error processing npub:", error);
      return new Response(
        await HomeView({
          showNpubForm: true,
          error:
            "An error occurred while processing your npub. Please try again.",
        }),
        {
          headers: { "Content-Type": "text/html" },
          status: 500,
        },
      );
    }
  },
};

export default route;
