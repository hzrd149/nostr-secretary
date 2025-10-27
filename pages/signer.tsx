import { ServerSentEventGenerator } from "@starfederation/datastar-sdk/web";
import { NostrConnectAccount } from "applesauce-accounts/accounts";
import { NostrConnectSigner } from "applesauce-signers";
import type { BunRequest } from "bun";
import { BehaviorSubject } from "rxjs";
import Document from "../components/Document";
import Layout from "../components/Layout";
import { DEFAULT_SIGNER_RELAY } from "../const";
import config$, { getConfig, updateConfig } from "../services/config";
import { log } from "../services/logs";
import { pool, signer$ } from "../services/nostr";

const newSigner$ = new BehaviorSubject<NostrConnectSigner | null>(null);

function SetupPage() {
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

  // Generate QR code URL using qr-server.com (same as home.tsx)
  const connectUrl = signer.getNostrConnectURI({
    name: "Nostr Secretary",
  });
  const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=256x256&data=${encodeURIComponent(signer.getNostrConnectURI())}`;

  return (
    <>
      <div class="success-message" data-show="$saved">
        ✅ Signer configuration updated successfully!
      </div>

      <div
        class="error-message"
        data-show="$error"
        style="margin-bottom: 20px; padding: 10px; background-color: #f8d7da; border: 1px solid #f5c6cb; border-radius: 4px; color: #721c24;"
      >
        ❌ <strong>Error:</strong> <span data-text="$error"></span>
      </div>

      {/* QR Code Section */}
      <div style="margin: 20px 0; padding: 20px; background-color: #f8fafc; border-radius: 8px;">
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
            style="background: white; padding: 10px; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);"
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

      {/* Success/Error Messages */}
      <div
        class="success-message"
        data-show="$connected"
        style="margin-bottom: 20px; padding: 10px; background-color: #d4edda; border: 1px solid #c3e6cb; border-radius: 4px; color: #155724;"
      >
        ✅ Signer connected successfully!
      </div>

      <div
        class="success-message"
        data-show="$saved"
        style="margin-bottom: 20px; padding: 10px; background-color: #d4edda; border: 1px solid #c3e6cb; border-radius: 4px; color: #155724;"
      >
        ✅ Signer configuration saved successfully!
      </div>

      <div
        class="error-message"
        data-show="$error"
        style="margin-bottom: 20px; padding: 10px; background-color: #f8d7da; border: 1px solid #f5c6cb; border-radius: 4px; color: #721c24;"
      >
        ❌ <strong>Error:</strong> <span data-text="$error"></span>
      </div>

      <style>{`
        .success-message[data-show="false"], .success-message:not([data-show="true"]) {
          display: none;
        }
        .success-message[data-show="true"] {
          display: block;
        }
        .error-message[data-show="false"], .error-message:not([data-show="true"]) {
          display: none;
        }
        .error-message[data-show="true"] {
          display: block;
        }
      `}</style>

      {/* Auto-connect on load */}
      <div data-on-load="@post(location.href)" style="display: none;"></div>

      {/* Alternative Manual Setup */}
      <div
        class="manual-setup"
        style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #e2e8f0;"
      >
        <h4 style="color: #4a5568; margin-bottom: 15px;">
          Or connect manually with Bunker URI:
        </h4>
        <div class="form-group">
          <label for="bunkerUri">Bunker URI</label>
          <div class="help-text">
            Paste your bunker:// URI from your Nostr Connect compatible app
            (like Alby, nsec.app, etc.)
          </div>
          <textarea
            id="bunkerUri"
            data-bind="bunkerUri"
            placeholder="bunker://pubkey@relay.example.com?secret=..."
            style="font-family: monospace; min-height: 120px; resize: vertical;"
          ></textarea>
        </div>

        <div class="button-group">
          <button
            type="button"
            class="btn-secondary"
            data-on-click="window.location.href='/'"
          >
            Cancel
          </button>
          <button
            type="button"
            class="btn-primary"
            data-on-click="@patch(location.href)"
            data-indicator-connecting
            data-attr-disabled="$connecting"
          >
            Connect with Bunker URI
          </button>
        </div>
      </div>
    </>
  );
}

function ConnectedPage() {
  const config = getConfig();

  return (
    <>
      <div
        class="status-section"
        style="margin-bottom: 20px; padding: 15px; background-color: #d4edda; border: 1px solid #c3e6cb; border-radius: 4px; color: #155724;"
      >
        <h3 style="margin-top: 0;">✅ Signer Connected</h3>
        <p>Your Nostr Connect signer is configured and ready to use.</p>
        {config.signer?.pubkey && (
          <p>
            <strong>Public Key:</strong> <code>{config.signer.pubkey}</code>
          </p>
        )}
      </div>

      <div class="button-group">
        <button
          type="button"
          class="btn-secondary"
          data-on-click="window.location.href='/'"
        >
          Back to Home
        </button>
        <button
          type="button"
          class="btn-danger"
          data-on-click="if (confirm('Are you sure you want to disconnect your signer? This will disable direct message decryption and relay authentication.')) { @delete(location.href) }"
          data-indicator-disconnecting
          data-attr-disabled="$disconnecting"
        >
          Disconnect Signer
        </button>
      </div>
    </>
  );
}

export function SignerView() {
  const config = config$.getValue();
  const hasSigner = !!config.signer;

  return (
    <Document title="Nostr Connect Signer">
      <Layout
        title="Nostr Connect Signer"
        subtitle="Configure your Nostr Connect signer for advanced features"
      >
        <div
          class="info-section"
          style="margin-bottom: 30px; padding: 15px; background-color: #d1ecf1; border: 1px solid #bee5eb; border-radius: 4px; color: #0c5460;"
        >
          <h3 style="margin-top: 0;">About Nostr Connect Signers</h3>
          <p>
            A Nostr Connect signer is <strong>optional</strong> for most
            notifications, but is <strong>required</strong> for:
          </p>
          <ul>
            <li>
              <strong>Decrypting direct messages</strong> - To read encrypted
              DMs and show their content in notifications
            </li>
            <li>
              <strong>Authenticating to relays</strong> - Some relays require
              authentication to read events
            </li>
          </ul>
          <p>
            The signer connects to a remote signing service (like Alby,
            nsec.app, or your own NIP-46 compatible app) via a secure bunker
            URI.
          </p>
        </div>

        <div id="content">{hasSigner ? <ConnectedPage /> : <SetupPage />}</div>
      </Layout>
    </Document>
  );
}

const route = {
  GET: async () => {
    return new Response(await (<SignerView />), {
      headers: { "Content-Type": "text/html" },
    });
  },
  POST: async () => {
    // QR code connection flow
    return ServerSentEventGenerator.stream(async (stream) => {
      const signer = newSigner$.value;

      try {
        if (!signer) throw new Error("No signer available");

        await signer.waitForSigner();
        log("Signer connected via QR");
        newSigner$.next(null);

        const pubkey = await signer.getPublicKey();
        log("Found pubkey", { pubkey });

        // Create account and update config
        const account = new NostrConnectAccount(pubkey, signer);

        // Set the signer
        signer$.next(account);

        // Update the config
        updateConfig({ signer: account.toJSON() });

        // Signal success
        stream.patchElements(
          await (
            <div id="content">
              <ConnectedPage />
            </div>
          ),
        );
      } catch (error) {
        log("QR signer connection error:", { error });
        stream.patchSignals(
          JSON.stringify({
            error: `Failed to connect signer: ${error instanceof Error ? error.message : "Unknown error"}`,
            connected: false,
          }),
        );
      }
    });
  },
  PATCH: async (req: BunRequest) => {
    // Manual bunker URI connection flow
    const reader = await ServerSentEventGenerator.readSignals(req);
    if (!reader.success) throw new Error(reader.error);

    return ServerSentEventGenerator.stream(async (stream) => {
      const { signals } = reader;
      const bunkerUri = signals.bunkerUri as string;

      try {
        if (!bunkerUri || !bunkerUri.trim())
          throw new Error("Bunker URI is required");

        try {
          // Create signer from bunker URI
          const signer = await NostrConnectSigner.fromBunkerURI(
            bunkerUri.trim(),
          );

          // Test the connection by getting the public key
          const pubkey = await signer.getPublicKey();

          // Create account and update config
          const account = new NostrConnectAccount(pubkey, signer);

          // Set the signer
          signer$.next(account);

          // Update the config
          updateConfig({ signer: account.toJSON() });

          stream.patchElements(
            await (
              <div id="content">
                <SetupPage />
              </div>
            ),
          );
        } catch (signerError) {
          console.error("Signer connection error:", signerError);
          stream.patchSignals(
            JSON.stringify({
              error: `Failed to connect to signer: ${signerError instanceof Error ? signerError.message : "Unknown error"}`,
            }),
          );
        }
      } catch (error) {
        console.error("Form processing error:", error);
        stream.patchSignals(
          JSON.stringify({
            error: "Invalid form data or processing error",
          }),
        );
      }
    });
  },
  DELETE: async () => {
    return ServerSentEventGenerator.stream(async (stream) => {
      try {
        // Disconnect signer
        const currentConfig = config$.getValue();
        config$.next({ ...currentConfig, signer: undefined });

        // Replace view
        stream.patchElements(
          await (
            <div id="content">
              <SetupPage />
            </div>
          ),
        );
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
