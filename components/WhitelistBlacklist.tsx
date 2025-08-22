import { getTagValue } from "applesauce-core/helpers";
import { kinds, type NostrEvent } from "nostr-tools";
import { firstValueFrom, of, timeout } from "rxjs";
import { peopleLists$ } from "../services/nostr";

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
    peopleLists$.pipe(timeout({ first: 2000, with: () => of(undefined) })),
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
          <button
            type="button"
            class="btn-secondary"
            style="font-size: 0.9em; padding: 6px 12px;"
            onclick="addContactsList()"
          >
            Add Contacts List
          </button>
          {followSets.length > 0 && (
            <>
              <span style="font-size: 0.9em; color: #666;">or</span>
              <select
                id="followSetSelect"
                style="font-size: 0.9em; padding: 4px 8px;"
                onchange="addSelectedFollowSet()"
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

      <script>
        {`
          function addContactsList() {
            const pubkey = '${pubkey || ""}';
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
            const pubkey = '${pubkey || ""}';
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

          function addSelectedFollowSet() {
            const select = document.getElementById('followSetSelect');
            const coordinate = select.value;

            if (!coordinate) {
              return; // No selection, nothing to do
            }

            const textarea = document.getElementById('whitelists');
            const currentValue = textarea.value.trim();

            // Check if this coordinate is already in the list to avoid duplicates
            const lines = currentValue.split('\\n').map(line => line.trim()).filter(line => line);
            if (lines.includes(coordinate)) {
              select.value = ''; // Reset selection
              return;
            }

            if (currentValue) {
              textarea.value = currentValue + '\\n' + coordinate;
            } else {
              textarea.value = coordinate;
            }

            // Reset the select and focus the textarea
            select.value = '';
            textarea.focus();
            textarea.setSelectionRange(textarea.value.length, textarea.value.length);
          }
        `}
      </script>
    </>
  );
}
