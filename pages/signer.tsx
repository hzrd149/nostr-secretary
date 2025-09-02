import { ServerSentEventGenerator } from "@starfederation/datastar-sdk/web";
import type { RouterTypes } from "bun";
import Document from "../components/Document";
import Layout from "../components/Layout";
import config$, { updateConfig } from "../services/config";
import { NostrConnectSigner } from "applesauce-signers";
import { NostrConnectAccount } from "applesauce-accounts/accounts";
import { signer$ } from "../services/nostr";

export function SignerView() {
  const currentConfig = config$.getValue();
  const hasSigner = !!currentConfig.signer;

  return (
    <Document title="Nostr Connect Signer">
      <Layout
        title="Nostr Connect Signer"
        subtitle="Configure your Nostr Connect signer for advanced features"
      >
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

        {hasSigner ? (
          <div class="signer-connected">
            <div
              class="status-section"
              style="margin-bottom: 20px; padding: 15px; background-color: #d4edda; border: 1px solid #c3e6cb; border-radius: 4px; color: #155724;"
            >
              <h3 style="margin-top: 0;">✅ Signer Connected</h3>
              <p>Your Nostr Connect signer is configured and ready to use.</p>
              {currentConfig.signer?.pubkey && (
                <p>
                  <strong>Public Key:</strong>{" "}
                  <code>{currentConfig.signer.pubkey}</code>
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
          </div>
        ) : (
          <div class="signer-setup">
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
                data-on-click="@post(location.href)"
                data-indicator-connecting
                data-attr-disabled="$connecting"
              >
                Connect Signer
              </button>
            </div>
          </div>
        )}
      </Layout>
    </Document>
  );
}

const route: RouterTypes.RouteValue<"/signer"> = {
  GET: async () => {
    return new Response(await SignerView(), {
      headers: { "Content-Type": "text/html" },
    });
  },
  POST: async (req) => {
    const reader = await ServerSentEventGenerator.readSignals(req);
    if (!reader.success) throw new Error(reader.error);

    return ServerSentEventGenerator.stream(async (stream) => {
      const { signals } = reader;
      const bunkerUri = signals.bunkerUri as string;

      try {
        if (!bunkerUri || !bunkerUri.trim()) {
          stream.patchSignals(
            JSON.stringify({ error: "Bunker URI is required" }),
          );
          return;
        }

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

          stream.patchSignals(JSON.stringify({ saved: true }));
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
