import { getTagValue } from "applesauce-core/helpers";
import { kinds, type NostrEvent } from "nostr-tools";
import { firstValueFrom, of, timeout, toArray } from "rxjs";
import { lists$ } from "../services/nostr";

export interface WhitelistBlacklistProps {
  whitelists: string[];
  blacklists: string[];
  pubkey?: string;
}

export default async function WhitelistBlacklist({
  whitelists,
  blacklists,
  pubkey,
}: WhitelistBlacklistProps) {
  const lists = await firstValueFrom(
    lists$.pipe(timeout({ first: 2000, with: () => of(undefined) })),
  );

  // Filter to get only follow sets (kind 30000)
  const allLists = Array.isArray(lists) ? lists : lists ? [lists] : [];
  const followSets = allLists.filter(
    (event: NostrEvent) => event.kind === kinds.Followsets,
  );

  return (
    <>
      <div class="form-group">
        <label for="whitelists">Whitelists (NIP-51 Lists)</label>
        <div class="help-text">
          NIP-51 list coordinates or naddr identifiers for users you want to
          receive notifications from. One per line. If empty, notifications will
          be sent from everyone (unless blacklisted).
        </div>
        <div class="help-text" style="margin-top: 5px; font-style: italic;">
          Format: <code>kind:pubkey:identifier</code> or <code>naddr1...</code>
        </div>
        <textarea
          id="whitelists"
          name="whitelists"
          placeholder="3:abc123...def456:contacts&#10;naddr1..."
          rows="6"
          safe
        >
          {whitelists.join("\n")}
        </textarea>
        <div style="margin-top: 8px; display: flex; gap: 8px; align-items: center;">
          {pubkey && (
            <button
              type="button"
              class="btn-secondary"
              style="font-size: 0.9em; padding: 6px 12px;"
              data-on-click={`
                const textarea = document.getElementById('whitelists');
                const currentValue = textarea.value.trim();
                const newLine = '3:${pubkey || ""}:';
                textarea.value = currentValue ? currentValue + '\\n' + newLine : newLine;
                textarea.focus();
                textarea.setSelectionRange(textarea.value.length, textarea.value.length);
              `}
            >
              Add Contacts List
            </button>
          )}
          {followSets.length > 0 && (
            <>
              <span style="font-size: 0.9em; color: #666;">or</span>
              <select
                id="followSetSelect"
                style="font-size: 0.9em; padding: 4px 8px;"
                data-on-change={`
                  if (!$el.value) return;
                  const textarea = document.getElementById('whitelists');
                  const currentValue = textarea.value.trim();
                  const lines = currentValue.split('\\n').map(line => line.trim()).filter(line => line);
                  if (lines.includes($el.value)) {
                    $el.value = '';
                    return;
                  }
                  textarea.value = currentValue ? currentValue + '\\n' + $el.value : $el.value;
                  $el.value = '';
                  textarea.focus();
                  textarea.setSelectionRange(textarea.value.length, textarea.value.length);
                `}
              >
                <option value="">Select Follow Set</option>
                {followSets.map((followSet: NostrEvent) => {
                  const dTag = getTagValue(followSet, "d") || "";
                  const title =
                    getTagValue(followSet, "title") || dTag || "Untitled Set";
                  const coordinate = `${followSet.kind}:${followSet.pubkey}:${dTag}`;
                  return <option value={coordinate}>{title}</option>;
                })}
              </select>
            </>
          )}
        </div>
      </div>

      <div class="form-group">
        <label for="blacklists">Blacklists (NIP-51 Lists)</label>
        <div class="help-text">
          NIP-51 list coordinates or naddr identifiers for users you want to
          exclude from notifications. One per line.
        </div>
        <div class="help-text" style="margin-top: 5px; font-style: italic;">
          Format: <code>kind:pubkey:identifier</code> or <code>naddr1...</code>
        </div>
        <textarea
          id="blacklists"
          name="blacklists"
          placeholder="10000:abc123...def456:mutes&#10;naddr1..."
          rows="6"
          safe
        >
          {blacklists.join("\n")}
        </textarea>
        {pubkey && (
          <div style="margin-top: 8px;">
            <button
              type="button"
              class="btn-secondary"
              style="font-size: 0.9em; padding: 6px 12px;"
              data-on-click={`
                const textarea = document.getElementById('blacklists');
                const currentValue = textarea.value.trim();
                const newLine = '10000:${pubkey}:';
                textarea.value = currentValue ? currentValue + '\\n' + newLine : newLine;
                textarea.focus();
                textarea.setSelectionRange(textarea.value.length, textarea.value.length);
              `}
            >
              Add Mutes List
            </button>
          </div>
        )}
      </div>
    </>
  );
}
