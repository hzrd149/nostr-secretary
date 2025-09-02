import type { RouterTypes } from "bun";
import Document from "../components/Document";
import Layout from "../components/Layout";
import config$, { updateConfig } from "../services/config";
import { NostrConnectSigner } from "applesauce-signers";
import { NostrConnectAccount } from "applesauce-accounts/accounts";
import { signer$ } from "../services/nostr";

export function SignerView({
  saved,
  error,
}: {
  saved?: boolean;
  error?: string;
}) {
  const currentConfig = config$.getValue();
  const hasSigner = !!currentConfig.signer;

  return (
    <Document title="Nostr Connect Signer">
      <Layout
        title="Nostr Connect Signer"
        subtitle="Configure your Nostr Connect signer for advanced features"
      >
        {saved && (
          <div id="successMessage" class="success-message">
            ✅ Signer configuration updated successfully!
          </div>
        )}

        {error && (
          <div
            id="errorMessage"
            class="error-message"
            style="margin-bottom: 20px; padding: 10px; background-color: #f8d7da; border: 1px solid #f5c6cb; border-radius: 4px; color: #721c24;"
          >
            ❌ <strong>Error:</strong> {error}
          </div>
        )}

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

            <form method="POST" action="/signer">
              <input type="hidden" name="_method" value="PATCH" />
              <input type="hidden" name="action" value="disconnect" />
              <div class="button-group">
                <button
                  type="button"
                  class="btn-secondary"
                  data-on-click="window.location.href='/'"
                >
                  Back to Home
                </button>
                <button
                  type="submit"
                  class="btn-danger"
                  data-on-click="if (confirm('Are you sure you want to disconnect your signer? This will disable direct message decryption and relay authentication.')) { $el.form.submit(); }"
                >
                  Disconnect Signer
                </button>
              </div>
            </form>
          </div>
        ) : (
          <div class="signer-setup">
            <form method="POST" action="/signer">
              <div class="form-group">
                <label for="bunkerUri">Bunker URI</label>
                <div class="help-text">
                  Paste your bunker:// URI from your Nostr Connect compatible
                  app (like Alby, nsec.app, etc.)
                </div>
                <textarea
                  id="bunkerUri"
                  name="bunkerUri"
                  placeholder="bunker://pubkey@relay.example.com?secret=..."
                  required
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
                <button type="submit" class="btn-primary">
                  Connect Signer
                </button>
              </div>
            </form>
          </div>
        )}
      </Layout>
    </Document>
  );
}

const route: RouterTypes.RouteValue<"/signer"> = {
  GET: async () => {
    return new Response(await SignerView({}), {
      headers: { "Content-Type": "text/html" },
    });
  },
  POST: async (req) => {
    try {
      const formData = await req.formData();
      const method = formData.get("_method") as string;

      if (method === "PATCH") {
        // Disconnect signer
        const currentConfig = config$.getValue();
        config$.next({ ...currentConfig, signer: undefined });

        return new Response(await SignerView({ saved: true }), {
          headers: { "Content-Type": "text/html" },
        });
      } else {
        // Connect new signer
        const bunkerUri = formData.get("bunkerUri") as string;

        if (!bunkerUri || !bunkerUri.trim()) {
          return new Response(
            await SignerView({ error: "Bunker URI is required" }),
            {
              headers: { "Content-Type": "text/html" },
            },
          );
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

          return new Response(await SignerView({ saved: true }), {
            headers: { "Content-Type": "text/html" },
          });
        } catch (signerError) {
          console.error("Signer connection error:", signerError);
          return new Response(
            await SignerView({
              error: `Failed to connect to signer: ${signerError instanceof Error ? signerError.message : "Unknown error"}`,
            }),
            {
              headers: { "Content-Type": "text/html" },
            },
          );
        }
      }
    } catch (error) {
      console.error("Form processing error:", error);
      return new Response(
        await SignerView({
          error: "Invalid form data or processing error",
        }),
        {
          headers: { "Content-Type": "text/html" },
        },
      );
    }
  },
};

export default route;
