import { ServerSentEventGenerator } from "@starfederation/datastar-sdk/web";
import type { BunRequest } from "bun";
import Document from "../components/Document";
import Layout from "../components/Layout";
import WhitelistBlacklist from "../components/WhitelistBlacklist";
import config$ from "../services/config";
import { unique } from "../helpers/array";
import { CACHI_GROUP_LINK } from "../const";

export function GroupsConfigView() {
  const currentConfig = config$.getValue();
  const groupsConfig = currentConfig.groups;

  return (
    <Document title="Group Notifications">
      <Layout
        title="Group Notifications"
        subtitle="Configure NIP-29 group notification settings"
      >
        <div class="success-message" data-show="$saved">
          ✅ Group configuration saved successfully!
        </div>

        <div
          class="error-message"
          data-show="$error"
          style="margin-bottom: 20px; padding: 10px; background-color: #f8d7da; border: 1px solid #f5c6cb; border-radius: 4px; color: #721c24;"
        >
          ❌ <span data-text="$error"></span>
        </div>
        <div class="form-group">
          <div style="display: flex; align-items: flex-start; gap: 10px;">
            <input
              type="checkbox"
              id="enabled"
              data-bind="enabled"
              checked={groupsConfig.enabled}
              style="margin-top: 4px; width: 20px; height: 20px;"
            />
            <div style="flex: 1;">
              <label
                for="enabled"
                style="font-weight: bold; margin-bottom: 8px; display: block;"
              >
                Enable Group Notifications
              </label>
              <div class="help-text">
                Receive notifications when there's activity in your NIP-29
                groups (channels).
              </div>
            </div>
          </div>
        </div>

        <div class="form-group">
          <label
            for="groupLink"
            style="font-weight: bold; margin-bottom: 8px; display: block;"
          >
            Group Link Template
          </label>

          <div style="display: flex; align-items: center; gap: 10px;">
            <input
              type="text"
              id="groupLink"
              data-bind="groupLink"
              value={groupsConfig.groupLink}
              placeholder={CACHI_GROUP_LINK}
              style="flex: 1;"
            />
            <select
              data-on-change="$groupLink = el.value"
              style="min-width: 200px; flex-shrink: 0;"
            >
              <option value="">Choose a preset...</option>
              <option value={CACHI_GROUP_LINK}>Chachi.chat</option>
              <option value="https://groups.nip29.com/?relay=wss://{relay}&groupId={id}">
                groups.nip29.com
              </option>
            </select>
          </div>
          <div class="help-text" style="margin-top: 5px;">
            Template for group links in notifications. Use{" "}
            <code>{"{relay}"}</code> for the relay URL and <code>{"{id}"}</code>{" "}
            for the group ID. Select a preset above or enter a custom template.
          </div>
        </div>

        <WhitelistBlacklist
          whitelists={groupsConfig.whitelists}
          blacklists={groupsConfig.blacklists}
          pubkey={currentConfig.pubkey}
        />

        <div class="button-group">
          <button
            type="button"
            class="btn-secondary"
            data-on-click="window.location.href='/notifications'"
          >
            Back to Notifications
          </button>
          <button
            class="btn-primary"
            data-on-click="@patch(location.href)"
            data-indicator-saving
            data-attr-disabled="$saving"
          >
            Save Group Settings
          </button>
        </div>
      </Layout>
    </Document>
  );
}

const route = {
  GET: async () => {
    return new Response(await GroupsConfigView(), {
      headers: { "Content-Type": "text/html" },
    });
  },
  PATCH: async (req: BunRequest) => {
    const reader = await ServerSentEventGenerator.readSignals(req);
    if (!reader.success) throw new Error(reader.error);

    return ServerSentEventGenerator.stream(async (stream) => {
      const { signals } = reader;
      const enabled = signals.enabled as boolean;
      const groupLink = signals.groupLink as string;
      const whitelistsText = signals.whitelists as string;
      const blacklistsText = signals.blacklists as string;

      try {
        // Parse whitelists and blacklists from textarea (one per line)
        const whitelists = unique(
          whitelistsText
            ?.split("\n")
            .map((line) => line.trim())
            .filter((line) => line.length > 0) || [],
        );

        const blacklists = unique(
          blacklistsText
            ?.split("\n")
            .map((line) => line.trim())
            .filter((line) => line.length > 0) || [],
        );

        // Update config
        const currentConfig = config$.getValue();
        const newConfig = {
          ...currentConfig,
          groups: {
            enabled: !!enabled,
            groupLink: groupLink?.trim() || CACHI_GROUP_LINK,
            whitelists,
            blacklists,
          },
        };

        config$.next(newConfig);

        // Signal success
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
