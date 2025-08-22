import type { RouterTypes } from "bun";
import Document from "../components/Document";
import Layout from "../components/Layout";
import WhitelistBlacklist from "../components/WhitelistBlacklist";
import config$ from "../services/config";
import { unique } from "../helpers/array";
import { CACHI_GROUP_LINK } from "../const";

export function GroupsConfigView({ saved }: { saved?: boolean }) {
  const currentConfig = config$.getValue();
  const groupsConfig = currentConfig.groups;

  return (
    <Document title="Group Notifications">
      <Layout
        title="Group Notifications"
        subtitle="Configure NIP-29 group notification settings"
      >
        {saved && (
          <div id="successMessage" class="success-message">
            ✅ Group configuration saved successfully!
          </div>
        )}

        <form action="/groups" method="POST">
          <div class="form-group">
            <div style="display: flex; align-items: flex-start; gap: 10px;">
              <input
                type="checkbox"
                id="enabled"
                name="enabled"
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
                name="groupLink"
                value={groupsConfig.groupLink}
                placeholder={CACHI_GROUP_LINK}
              />
              <select
                id="groupLinkPreset"
                name="groupLinkPreset"
                onchange="document.getElementById('groupLink').value = this.value"
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
              <code>{"{relay}"}</code> for the relay URL and{" "}
              <code>{"{id}"}</code> for the group ID. Select a preset above or
              enter a custom template.
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
              onclick="window.location.href='/notifications'"
            >
              Back to Notifications
            </button>
            <button type="submit" class="btn-primary">
              Save Group Settings
            </button>
          </div>
        </form>
      </Layout>
    </Document>
  );
}

const route: RouterTypes.RouteValue<"/groups"> = {
  GET: async () => {
    return new Response(await GroupsConfigView({}), {
      headers: { "Content-Type": "text/html" },
    });
  },
  POST: async (req) => {
    try {
      const formData = await req.formData();
      const enabled = formData.has("enabled");
      const groupLink =
        (formData.get("groupLink") as string) || CACHI_GROUP_LINK;
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
        groups: {
          enabled,
          groupLink,
          whitelists,
          blacklists,
        },
      };

      config$.next(newConfig);

      // Redirect back to groups page with success
      return new Response(await GroupsConfigView({ saved: true }), {
        headers: { "Content-Type": "text/html" },
      });
    } catch (error) {
      return new Response("Invalid form data", { status: 400 });
    }
  },
};

export default route;
