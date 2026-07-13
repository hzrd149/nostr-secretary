import { ServerSentEventGenerator } from "@starfederation/datastar-sdk/web";
import type { BunRequest } from "bun";
import { defined } from "applesauce-core";
import {
  encodeGroupPointer,
  getGroupPointerFromGroupTag,
  // The project helper (helpers/groups.ts) fetches a kind-39000 event over the
  // network; applesauce's export of the same name parses an already-fetched
  // event. Both are needed here, so both are aliased on import (Pitfall 4).
  getGroupMetadata as parseGroupMetadata,
  type GroupPointer,
} from "applesauce-common/helpers";
import { firstValueFrom, of, timeout } from "rxjs";
import Document from "../components/Document";
import Layout from "../components/Layout";
import WhitelistBlacklist from "../components/WhitelistBlacklist";
import config$ from "../services/config";
import { groups$ } from "../services/nostr";
import { unique } from "../helpers/array";
import { CACHI_GROUP_LINK } from "../const";
import {
  getGroupMetadata as fetchGroupMetadataEvent,
  getGroupMode,
  isGroupNotificationMode,
  type GroupNotificationMode,
} from "../helpers/groups";

const MODE_LABEL: Record<GroupNotificationMode, string> = {
  all: "All messages",
  mentions: "Only @mentions",
  muted: "Muted",
};

// Per-group mode status colors (01-UI-SPEC.md "Per-group mode status
// colors"), following the existing .notification-status light-bg/dark-text/
// border convention from pages/notifications.tsx.
const MODE_BADGE: Record<
  GroupNotificationMode,
  { bg: string; text: string; border: string }
> = {
  all: { bg: "#d4edda", text: "#155724", border: "#c3e6cb" },
  mentions: { bg: "#fff3cd", text: "#856404", border: "#ffeaa7" },
  muted: { bg: "#f8d7da", text: "#721c24", border: "#f5c6cb" },
};

/**
 * Derives the joined-groups list server-side from groups$ (kind 10009),
 * reusing the SAME `.filter((t) => t[0] === "group" && t[1])
 * .map(getGroupPointerFromGroupTag)` chain used by services/nostr.ts and
 * notifications/groups.ts, so GET's render order and PATCH's positional
 * mode_N zip always stay in lockstep (Pitfall 2). Falls back to an empty
 * list if groups$ never resolves a defined value within the timeout (e.g.
 * the user has no kind 10009 list at all), so the page renders the empty
 * state instead of hanging indefinitely.
 */
async function getJoinedGroups(): Promise<GroupPointer[]> {
  const list = await firstValueFrom(
    groups$.pipe(
      defined(),
      timeout({ first: 5000, with: () => of(undefined) }),
    ),
  );
  if (!list) return [];

  return list.tags
    .filter((t) => t[0] === "group" && t[1])
    .map(getGroupPointerFromGroupTag);
}

export async function GroupsConfigView() {
  const currentConfig = config$.getValue();
  const groupsConfig = currentConfig.groups;

  const joinedGroups = await getJoinedGroups();
  const metadataByIndex = await Promise.all(
    joinedGroups.map((group) =>
      // Degrade gracefully per-group: a relay connection error (as opposed
      // to the timeout already handled inside fetchGroupMetadataEvent)
      // must not reject the whole Promise.all and take down the entire
      // /groups page for every other group (WR-01).
      fetchGroupMetadataEvent(group).catch(() => undefined),
    ),
  );

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

        {joinedGroups.length === 0 ? (
          <div class="form-group">
            <div style="text-align: center; padding: 24px 16px; color: #718096;">
              <div style="font-weight: 600; font-size: 1.125rem; color: #2d3748; margin-bottom: 8px;">
                No groups joined yet
              </div>
              <div
                class="help-text"
                style="margin: 0 auto; max-width: 480px; font-size: 1rem;"
              >
                You haven't joined any NIP-29 groups yet. Once you join a
                group from a NIP-29 client (e.g. chachi.chat), it will appear
                here so you can set its notification mode.
              </div>
            </div>
          </div>
        ) : (
          <div class="form-group">
            <label style="font-weight: bold; margin-bottom: 8px; display: block;">
              Joined Groups
            </label>
            {joinedGroups.map((group, index) => {
              const metaEvent = metadataByIndex[index];
              const meta = metaEvent && parseGroupMetadata(metaEvent);
              const mode = getGroupMode(groupsConfig.modes, group);
              const badge = MODE_BADGE[mode];

              return (
                <div
                  class="group-row"
                  style="display: flex; align-items: center; gap: 10px; padding: 12px 0; border-bottom: 1px solid #e2e8f0;"
                >
                  {meta?.picture ? (
                    <img
                      src={meta.picture}
                      style="width: 40px; height: 40px; border-radius: 50%; object-fit: cover; flex-shrink: 0;"
                    />
                  ) : (
                    <div style="width: 40px; height: 40px; border-radius: 50%; background: #e2e8f0; display: flex; align-items: center; justify-content: center; font-size: 1.2rem; flex-shrink: 0;">
                      👥
                    </div>
                  )}
                  <span
                    safe
                    style={`flex: 1; font-size: 1.125rem; font-weight: 600; ${
                      meta?.name
                        ? "color: #2d3748;"
                        : "color: #718096; font-style: italic;"
                    }`}
                  >
                    {meta?.name ?? "Unnamed group"}
                  </span>
                  <span
                    style={`font-weight: 600; font-size: 0.8rem; padding: 4px 10px; border-radius: 6px; text-transform: uppercase; text-align: center; flex-shrink: 0; background: ${badge.bg}; color: ${badge.text}; border: 1px solid ${badge.border};`}
                  >
                    {MODE_LABEL[mode]}
                  </span>
                  <select
                    data-bind={`mode_${index}`}
                    style="min-width: 160px; min-height: 44px; flex-shrink: 0;"
                  >
                    <option value="all" selected={mode === "all"}>
                      All messages
                    </option>
                    <option value="mentions" selected={mode === "mentions"}>
                      Only @mentions
                    </option>
                    <option value="muted" selected={mode === "muted"}>
                      Muted
                    </option>
                  </select>
                </div>
              );
            })}
          </div>
        )}

        <div class="form-group">
          <label
            for="rateLimitPerType"
            style="font-weight: bold; margin-bottom: 8px; display: block;"
          >
            Rate Limit
          </label>
          <input
            type="number"
            id="rateLimitPerType"
            data-bind="rateLimitPerType"
            min="0"
            value={String(currentConfig.rateLimit.perType.groups)}
          />
          <div class="help-text">
            Max group notifications per window. 0 = unlimited.
          </div>
        </div>

        <div class="form-group">
          <label
            for="rateLimitPerGroup"
            style="font-weight: bold; margin-bottom: 8px; display: block;"
          >
            Default Per-Group Rate Limit
          </label>
          <input
            type="number"
            id="rateLimitPerGroup"
            data-bind="rateLimitPerGroup"
            min="0"
            value={String(currentConfig.rateLimit.perGroup)}
          />
          <div class="help-text">
            Caps notifications from any single group per window. Applied
            automatically to newly-joined groups. 0 = unlimited.
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
      const rawRateLimitPerType = Number(signals.rateLimitPerType);
      const rawRateLimitPerGroup = Number(signals.rateLimitPerGroup);

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

        // Re-derive joinedGroups server-side using the SAME getJoinedGroups()
        // helper GET uses, so the positional order matches what was rendered
        // and the mode_N signals zip onto the correct groups (Pitfall 2).
        const currentConfig = config$.getValue();
        const joinedGroups = await getJoinedGroups();

        // Start from the existing modes map so entries for groups the user
        // has since left are preserved (harmless orphans, D-10) rather than
        // pruned on every save; only currently-joined groups are overwritten
        // below with their newly submitted (and validated) mode.
        const modes: Record<string, GroupNotificationMode> = {
          ...currentConfig.groups.modes,
        };
        joinedGroups.forEach((group, index) => {
          const raw = signals[`mode_${index}`];
          // ASVS V5 (T-01-01): never trust the client-submitted mode string
          // verbatim -- only write it if it's one of the three literal modes.
          if (isGroupNotificationMode(raw)) {
            modes[encodeGroupPointer(group)] = raw;
          }
        });

        // ASVS V5: clamp the incoming rate-limit signal to a non-negative
        // integer (finite >= 0, floor floats) before merging -- never trust
        // an untrusted client-submitted number verbatim.
        const rateLimitPerType =
          Number.isFinite(rawRateLimitPerType) && rawRateLimitPerType >= 0
            ? Math.floor(rawRateLimitPerType)
            : currentConfig.rateLimit.perType.groups;

        const rateLimitPerGroup =
          Number.isFinite(rawRateLimitPerGroup) && rawRateLimitPerGroup >= 0
            ? Math.floor(rawRateLimitPerGroup)
            : currentConfig.rateLimit.perGroup;

        // Update config
        const newConfig = {
          ...currentConfig,
          groups: {
            enabled: !!enabled,
            groupLink: groupLink?.trim() || CACHI_GROUP_LINK,
            whitelists,
            blacklists,
            modes,
          },
          rateLimit: {
            ...currentConfig.rateLimit,
            perGroup: rateLimitPerGroup,
            perType: {
              ...currentConfig.rateLimit.perType,
              groups: rateLimitPerType,
            },
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
