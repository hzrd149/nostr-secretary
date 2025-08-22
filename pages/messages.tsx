import type { RouterTypes } from "bun";
import Document from "../components/Document";
import Layout from "../components/Layout";
import config$ from "../services/config";
import { unique } from "../helpers/array";

export function MessagesConfigView({ saved }: { saved?: boolean }) {
  const currentConfig = config$.getValue();
  const messagesConfig = currentConfig.messages;

  return (
    <Document title="Message Notifications">
      <Layout
        title="Message Notifications"
        subtitle="Configure direct message notification settings"
      >
        {saved && (
          <div id="successMessage" class="success-message">
            ✅ Message configuration saved successfully!
          </div>
        )}

        <form action="/messages" method="POST">
          <div class="form-group">
            <div style="display: flex; align-items: flex-start; gap: 10px;">
              <input
                type="checkbox"
                id="enabled"
                name="enabled"
                checked={messagesConfig.enabled}
                style="margin-top: 4px; width: 20px; height: 20px;"
              />
              <div style="flex: 1;">
                <label
                  for="enabled"
                  style="font-weight: bold; margin-bottom: 8px; display: block;"
                >
                  Enable Direct Message Notifications
                </label>
                <div class="help-text">
                  Receive notifications when you get direct messages (DMs) on
                  Nostr.
                </div>
              </div>
            </div>
          </div>

          <div class="form-group">
            <div style="display: flex; align-items: flex-start; gap: 10px;">
              <input
                type="checkbox"
                id="sendContent"
                name="sendContent"
                checked={messagesConfig.sendContent}
                style="margin-top: 4px; width: 20px; height: 20px;"
              />
              <div style="flex: 1;">
                <label
                  for="sendContent"
                  style="font-weight: bold; margin-bottom: 8px; display: block;"
                >
                  Include Message Content in Notifications
                </label>
                <div class="help-text">
                  When enabled, the actual message content will be included in
                  notifications.
                </div>
                <div
                  class="warning-text"
                  style="margin-top: 10px; padding: 12px; background-color: #ffe6e6; border: 1px solid #ff9999; border-radius: 4px; color: #cc0000;"
                >
                  ⚠️ <strong>Privacy Warning:</strong> Enabling this feature
                  will send the <strong>unencrypted, plaintext content</strong>{" "}
                  of your direct messages through the notification server. Only
                  enable this if you trust your notification server and
                  understand the privacy implications.
                </div>
              </div>
            </div>
          </div>

          <div class="form-group">
            <label for="whitelists">Whitelists (NIP-51 Lists)</label>
            <div class="help-text">
              NIP-51 list coordinates or naddr identifiers for users you want to
              receive notifications from. One per line. If empty, notifications
              will be sent from everyone (unless blacklisted).
            </div>
            <div class="help-text" style="margin-top: 5px; font-style: italic;">
              Format: <code>kind:pubkey:identifier</code> or{" "}
              <code>naddr1...</code>
            </div>
            <textarea
              id="whitelists"
              name="whitelists"
              placeholder="3:abc123...def456:contacts&#10;naddr1..."
              rows="6"
              safe
            >
              {messagesConfig.whitelists.join("\n")}
            </textarea>
            <div style="margin-top: 8px;">
              <button
                type="button"
                class="btn-secondary"
                style="font-size: 0.9em; padding: 6px 12px;"
                onclick="addContactsList()"
              >
                Add Contacts List
              </button>
            </div>
          </div>

          <div class="form-group">
            <label for="blacklists">Blacklists (NIP-51 Lists)</label>
            <div class="help-text">
              NIP-51 list coordinates or naddr identifiers for users you want to
              exclude from notifications. One per line.
            </div>
            <div class="help-text" style="margin-top: 5px; font-style: italic;">
              Format: <code>kind:pubkey:identifier</code> or{" "}
              <code>naddr1...</code>
            </div>
            <textarea
              id="blacklists"
              name="blacklists"
              placeholder="10000:abc123...def456:mutes&#10;naddr1..."
              rows="6"
              safe
            >
              {messagesConfig.blacklists.join("\n")}
            </textarea>
            <div style="margin-top: 8px;">
              <button
                type="button"
                class="btn-secondary"
                style="font-size: 0.9em; padding: 6px 12px;"
                onclick="addMutesList()"
              >
                Add Mutes List
              </button>
            </div>
          </div>

          <div class="button-group">
            <button
              type="button"
              class="btn-secondary"
              onclick="window.location.href='/config'"
            >
              Back to Config
            </button>
            <button type="submit" class="btn-primary">
              Save Message Settings
            </button>
          </div>
        </form>

        <script>
          {`
            function addContactsList() {
              const pubkey = '${currentConfig.pubkey || ""}';
              if (!pubkey) {
                alert('Please set your public key in the main configuration first.');
                return;
              }

              const textarea = document.getElementById('whitelists');
              const currentValue = textarea.value.trim();
              const newLine = '3:' + pubkey + ':';

              if (currentValue) {
                textarea.value = currentValue + '\\n' + newLine;
              } else {
                textarea.value = newLine;
              }

              // Focus at the end of the new line
              textarea.focus();
              textarea.setSelectionRange(textarea.value.length, textarea.value.length);
            }

            function addMutesList() {
              const pubkey = '${currentConfig.pubkey || ""}';
              if (!pubkey) {
                alert('Please set your public key in the main configuration first.');
                return;
              }

              const textarea = document.getElementById('blacklists');
              const currentValue = textarea.value.trim();
              const newLine = '10000:' + pubkey + ':';

              if (currentValue) {
                textarea.value = currentValue + '\\n' + newLine;
              } else {
                textarea.value = newLine;
              }

              // Focus at the end of the new line
              textarea.focus();
              textarea.setSelectionRange(textarea.value.length, textarea.value.length);
            }
          `}
        </script>
      </Layout>
    </Document>
  );
}

const route: RouterTypes.RouteValue<"/messages"> = {
  GET: async () => {
    return new Response(await MessagesConfigView({}), {
      headers: { "Content-Type": "text/html" },
    });
  },
  POST: async (req) => {
    try {
      const formData = await req.formData();
      const enabled = formData.has("enabled");
      const sendContent = formData.has("sendContent");
      const whitelistsText = formData.get("whitelists") as string;
      const blacklistsText = formData.get("blacklists") as string;

      // Parse whitelists and blacklists from textarea (one per line)
      const whitelists = unique(
        whitelistsText
          .split("\n")
          .map((line) => line.trim())
          .filter((line) => line.length > 0),
      );

      const blacklists = unique(
        blacklistsText
          .split("\n")
          .map((line) => line.trim())
          .filter((line) => line.length > 0),
      );

      // Update config
      const currentConfig = config$.getValue();
      const newConfig = {
        ...currentConfig,
        messages: {
          enabled,
          sendContent,
          whitelists,
          blacklists,
        },
      };

      config$.next(newConfig);

      // Redirect back to messages page with success
      return new Response(await MessagesConfigView({ saved: true }), {
        headers: { "Content-Type": "text/html" },
      });
    } catch (error) {
      return new Response("Invalid form data", { status: 400 });
    }
  },
};

export default route;
