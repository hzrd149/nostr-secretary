import { ServerSentEventGenerator } from "@starfederation/datastar-sdk/web";
import { NostrConnectAccount } from "applesauce-accounts/accounts";
import { normalizeToPubkey } from "applesauce-core/helpers";
import { NostrConnectSigner } from "applesauce-signers";
import type { RouterTypes } from "bun";
import { BehaviorSubject, firstValueFrom } from "rxjs";
import Document from "../components/Document";
import { DEFAULT_SIGNER_RELAY } from "../const";
import * as messagesNotification from "../notifications/messages";
import * as repliesNotification from "../notifications/replies";
import * as zapsNotification from "../notifications/zaps";
import config$, { updateConfig } from "../services/config";
import { log } from "../services/logs";
import { mailboxes$, messageInboxes$, pool, signer$ } from "../services/nostr";

const styles = `
.home-container {
  text-align: center;
  background: white;
  padding: 3rem;
  border-radius: 12px;
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.1);
  max-width: 600px;
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

.success-message {
  margin-bottom: 20px;
  padding: 10px;
  background-color: #d4edda;
  border: 1px solid #c3e6cb;
  border-radius: 4px;
  color: #155724;
  display: none;
}

.success-message[data-show="true"] {
  display: block;
}

.error-message {
  display: none;
}

.error-message[data-show="true"] {
  display: block;
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

function SetupComponent() {
  let signer = newSigner$.value;

  if (!signer) {
    log("Creating new signer");
    signer = new NostrConnectSigner({
      pool,
      relays: [DEFAULT_SIGNER_RELAY],
    });

    // Start waiting for the signer to connect
    signer.waitForSigner();

    // Set the signer
    newSigner$.next(signer);
  }

  // Generate QR code URL using qr-server.com (same as mobile.tsx)
  const connectUrl = signer.getNostrConnectURI({
    name: "Nostr Secretary",
  });
  const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=256x256&data=${encodeURIComponent(signer.getNostrConnectURI())}`;

  return (
    <>
      <p>Welcome! Please enter your Nostr npub to get started.</p>

      {/* QR Code Section */}
      {qrCodeUrl && (
        <div style="margin: 20px 0; padding: 20px; background-color: #f8fafc;">
          <h3 style="margin: 0 0 15px 0; color: #2d3748; font-size: 1.2rem;">
            🔐 Connect Your Signer App
          </h3>
          <p style="margin: 0 0 15px 0; color: #4a5568; font-size: 0.9rem;">
            Scan this QR code with your Nostr signer app (like Amber, Alby, or
            nsec.app) to securely connect:
          </p>
          <div style="display: flex; justify-content: center; margin: 15px 0;">
            <img
              src={qrCodeUrl}
              alt="Nostr Connect QR Code"
              style="background: white; padding: 10px;"
            />
          </div>
          <details style="margin-top: 15px;">
            <summary style="cursor: pointer; color: #4a5568; font-size: 0.85rem; margin-bottom: 5px;">
              Show connection URI (for manual entry)
            </summary>
            <code style="display: block; background: #f1f5f9; padding: 8px; border-radius: 4px; font-size: 0.75rem; word-break: break-all; color: #1a202c;">
              {connectUrl}
            </code>
          </details>
        </div>
      )}

      <div id="successMessage" class="success-message" data-show="$saved">
        ✅ Configuration saved successfully!
      </div>

      <div
        class="error-message"
        data-show="$error"
        style="color: red; margin: 10px 0; padding: 10px; border: 1px solid red; border-radius: 4px; background-color: #ffe6e6;"
      >
        ❌ <span data-text="$error"></span>
      </div>

      <div
        class="npub-form"
        style="margin: 20px 0;"
        data-on-load="@post(location.href)"
      >
        <div style="margin-bottom: 15px;">
          <label
            for="npub"
            style="display: block; margin-bottom: 5px; font-weight: bold;"
          >
            Your Nostr npub:
          </label>
          <input
            type="text"
            id="pubkey"
            data-bind-pubkey
            placeholder="npub1... or hex public key..."
            style="width: 100%; max-width: 500px; padding: 8px; border: 1px solid #ccc; border-radius: 4px; font-family: monospace;"
          />
          <small style="display: block; margin-top: 5px; color: #666;">
            Your npub starts with "npub1" and can be found in your Nostr client
            settings.
          </small>
        </div>
        <button
          type="button"
          class="btn-primary"
          data-on-click="@patch(location.href)"
          style="background-color: #007bff; color: white; padding: 10px 20px; border: none; border-radius: 4px; cursor: pointer; font-size: 16px;"
        >
          Save Configuration
        </button>
      </div>
    </>
  );
}

const newSigner$ = new BehaviorSubject<NostrConnectSigner | null>(null);

export function HomeView() {
  const config = config$.getValue();
  const setupMode = !config.pubkey;

  return (
    <Document title="Nostr Secretary">
      <style>{styles}</style>
      <div class="home-container">
        <h1>Nostr Secretary</h1>

        {setupMode ? (
          <SetupComponent />
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
    return new Response(await HomeView(), {
      headers: { "Content-Type": "text/html" },
    });
  },

  PATCH: async (req) => {
    const reader = await ServerSentEventGenerator.readSignals(req);
    if (!reader.success) throw new Error(reader.error);

    return ServerSentEventGenerator.stream(async (stream) => {
      const { signals } = reader;
      const pubkey = signals.pubkey as string;

      try {
        if (!pubkey?.trim()) throw new Error("Please enter your pubkey");

        const hexPubkey = normalizeToPubkey(pubkey.trim());
        if (!hexPubkey)
          throw new Error(
            "Invalid npub format. Please make sure it starts with 'npub1'",
          );

        // Update config with the new pubkey
        const currentConfig = config$.getValue();
        config$.next({ ...currentConfig, pubkey: hexPubkey });

        // Replace the whole page with the new home view
        stream.patchElements(await HomeView());
      } catch (error) {
        stream.patchSignals(
          JSON.stringify({
            error:
              error instanceof Error
                ? error.message
                : "An error occurred while processing your npub. Please try again.",
          }),
        );
      }
    });
  },

  // Post method for subscribing to new signer state
  POST: () =>
    ServerSentEventGenerator.stream(async (stream) => {
      const signer = newSigner$.value;
      if (!signer) return;

      try {
        await signer.waitForSigner();
        log("Signer connected via QR");
        newSigner$.next(null);

        const pubkey = await signer.getPublicKey();
        log("Found pubkey", { pubkey });

        // Create account and update config
        const account = new NostrConnectAccount(pubkey, signer);

        // Set the signer
        signer$.next(account);

        // Update the config with both pubkey and signer
        updateConfig({
          pubkey,
          signer: account.toJSON(),
        });

        // Setup is complete, so update home view
        stream.patchElements(await HomeView());
      } catch (error) {
        log("QR signer connection error:", { error });
        stream.patchSignals(
          JSON.stringify({
            error: `Failed to connect signer: ${error instanceof Error ? error.message : "Unknown error"}`,
          }),
        );
      }
    }),
};

export default route;
