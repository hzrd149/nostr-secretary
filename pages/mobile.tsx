import type { RouterTypes } from "bun";
import Document from "../components/Document";
import Layout from "../components/Layout";
import config$ from "../services/config";

export function MobileView() {
  const currentConfig = config$.getValue();
  const ntfyServer = currentConfig.server || "ntfy.sh";
  const ntfyTopic = currentConfig.topic || "";

  // Create ntfy:// link based on server and topic
  const ntfyLink = `ntfy://${ntfyServer}/${ntfyTopic}`;

  // QR Code URL using qr-server.com (free QR code API)
  const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(ntfyLink)}`;

  return (
    <Document title="Mobile Setup - Nostr Secretary">
      <Layout
        title="Mobile Setup"
        subtitle="Configure your mobile device for notifications"
      >
        {/* Instructions */}
        <div
          class="instructions"
          style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; margin-bottom: 30px; border-left: 4px solid #007bff;"
        >
          <h3 style="margin-top: 0; color: #007bff;">📱 Get the ntfy App</h3>
          <p>First, download the ntfy app on your mobile device:</p>
          <ul style="margin: 10px 0;">
            <li>
              <strong>Visit:</strong>{" "}
              <a
                href="https://ntfy.sh"
                target="_blank"
                rel="noopener noreferrer"
                style="color: #007bff; text-decoration: none;"
              >
                ntfy.sh
              </a>
            </li>
            <li>
              <strong>Android:</strong> Available on Google Play Store and
              F-Droid
            </li>
            <li>
              <strong>iOS:</strong> Available on the App Store
            </li>
          </ul>
        </div>

        {/* QR Code Section */}
        <div
          class="qr-section"
          style="text-align: center; margin-bottom: 30px; padding: 20px; border: 2px dashed #dee2e6; border-radius: 8px;"
        >
          <h3 style="margin-top: 0;">📷 Scan QR Code</h3>
          <p style="color: #6c757d; margin-bottom: 20px;">
            Scan this QR code with the ntfy app to automatically subscribe to
            your notifications:
          </p>

          {ntfyTopic ? (
            <div>
              <img
                src={qrCodeUrl}
                alt="ntfy QR Code"
                style="margin-bottom: 15px;"
              />
              <div style="font-family: monospace; background-color: #f8f9fa; padding: 10px; border-radius: 4px; font-size: 14px; word-break: break-all; user-select: all;">
                {ntfyLink}
              </div>
            </div>
          ) : (
            <div style="color: #dc3545; padding: 20px;">
              <p>
                ⚠️ No ntfy topic configured. Please set up your configuration
                first.
              </p>
              <a href="/config" style="color: #007bff; text-decoration: none;">
                Go to Configuration →
              </a>
            </div>
          )}
        </div>

        {/* Manual Setup Section */}
        <div
          class="manual-setup"
          style="background-color: #f8f9fa; padding: 20px; border-radius: 8px;"
        >
          <h3 style="margin-top: 0;">⚙️ Manual Setup</h3>
          <p style="color: #6c757d; margin-bottom: 20px;">
            Alternatively, you can manually add the subscription in the ntfy
            app:
          </p>

          <div class="config-fields" style="display: grid; gap: 15px;">
            <div>
              <label style="display: block; font-weight: bold; margin-bottom: 5px; color: #495057;">
                Server:
              </label>
              <div
                class="copy-field"
                style="display: flex; gap: 10px; align-items: center;"
              >
                <input type="text" value={ntfyServer} readonly />
                <button
                  onclick={`navigator.clipboard.writeText('${ntfyServer}').then(() => {
                      this.textContent = '✓ Copied!';
                      setTimeout(() => this.textContent = 'Copy', 2000);
                    })`}
                  class="btn-secondary"
                  style="max-width: 100px;"
                >
                  Copy
                </button>
              </div>
            </div>

            <div>
              <label style="display: block; font-weight: bold; margin-bottom: 5px; color: #495057;">
                Topic:
              </label>
              <div
                class="copy-field"
                style="display: flex; gap: 10px; align-items: center;"
              >
                <input
                  type="text"
                  value={ntfyTopic || "Not configured"}
                  readonly
                />
                {ntfyTopic && (
                  <button
                    onclick={`navigator.clipboard.writeText('${ntfyTopic}').then(() => {
                        this.textContent = '✓ Copied!';
                        setTimeout(() => this.textContent = 'Copy', 2000);
                      })`}
                    class="btn-secondary"
                    style="max-width: 100px;"
                  >
                    Copy
                  </button>
                )}
              </div>
            </div>
          </div>

          {!ntfyTopic && (
            <div style="margin-top: 15px; padding: 15px; background-color: #fff3cd; border: 1px solid #ffeaa7; border-radius: 4px; color: #856404;">
              <strong>⚠️ Configuration needed:</strong> Please configure your
              ntfy topic in the settings first.
              <br />
              <a
                href="/config"
                style="color: #007bff; text-decoration: none; margin-top: 5px; display: inline-block;"
              >
                Configure now →
              </a>
            </div>
          )}
        </div>

        {/* Additional Tips */}
        <div
          class="tips"
          style="margin-top: 30px; padding: 20px; background-color: #e7f3ff; border-radius: 8px; border-left: 4px solid #007bff;"
        >
          <h4 style="margin-top: 0; color: #007bff;">💡 Tips</h4>
          <ul style="color: #495057; margin: 0;">
            <li>
              Keep the ntfy app running in the background for instant
              notifications
            </li>
            <li>
              You can customize notification sounds and vibration patterns in
              the app settings
            </li>
            <li>
              The app supports priority levels - important notifications will
              show as pop-overs
            </li>
            <li>
              You can mute notifications temporarily using Do Not Disturb mode
            </li>
          </ul>
        </div>

        {/* Navigation */}
        <div class="nav-links" style="margin-top: 30px; text-align: center;">
          <a href="/" class="nav-link">
            Back to Home
          </a>
          <a href="/config" class="nav-link">
            Configuration
          </a>
        </div>
      </Layout>
    </Document>
  );
}

const route: RouterTypes.RouteValue<"/mobile"> = {
  GET: async () => {
    return new Response(await MobileView(), {
      headers: { "Content-Type": "text/html" },
    });
  },
};

export default route;
