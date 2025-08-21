import type { RouterTypes } from "bun";
import { firstValueFrom } from "rxjs";
import Document from "../components/Document";
import Layout from "../components/Layout";
import { mailboxes$, messageInboxes$, pool } from "../services/nostr";

const statusPageStyles = `
  .status-container {
    max-width: 800px;
    margin: 0 auto;
  }

  .status-section {
    margin-bottom: 2rem;
  }

  .status-section h3 {
    margin-bottom: 1rem;
    padding-bottom: 0.5rem;
    border-bottom: 2px solid #e9ecef;
    color: #495057;
  }

  .relay-status-list {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    margin-top: 1rem;
  }

  .relay-status-item {
    background: #f8f9fa;
    border: 1px solid #e9ecef;
    border-radius: 8px;
    padding: 1rem;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .relay-info {
    flex: 1;
  }

  .relay-url {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.25rem;
  }

  .relay-type {
    padding: 0.2rem 0.5rem;
    border-radius: 4px;
    font-size: 0.75rem;
    font-weight: 500;
    text-transform: uppercase;
  }

  .relay-type.inbox {
    background-color: #e3f2fd;
    color: #1976d2;
  }

  .relay-type.outbox {
    background-color: #f3e5f5;
    color: #7b1fa2;
  }

  .relay-type.dm {
    background-color: #fff3e0;
    color: #f57c00;
  }

  .relay-status {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 0.25rem;
  }

  .status-indicator {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
  }

  .status-indicator.connected .status-dot {
    background-color: #4caf50;
  }

  .status-indicator.disconnected .status-dot {
    background-color: #f44336;
  }

  .status-text {
    font-size: 0.9rem;
    font-weight: 500;
  }

  .status-indicator.connected .status-text {
    color: #4caf50;
  }

  .status-indicator.disconnected .status-text {
    color: #f44336;
  }

  .auth-indicator {
    font-size: 0.8rem;
  }

  .auth-indicator.authenticated .auth-text {
    color: #4caf50;
  }

  .auth-indicator.not-authenticated .auth-text {
    color: #ff9800;
  }

  .no-relays {
    text-align: center;
    padding: 2rem;
    background: #f8f9fa;
    border: 1px solid #e9ecef;
    border-radius: 8px;
  }

  .no-relays p {
    margin-bottom: 1rem;
    color: #6c757d;
  }

  @media (max-width: 768px) {
    .relay-status-item {
      flex-direction: column;
      align-items: flex-start;
      gap: 1rem;
    }

    .relay-status {
      align-items: flex-start;
    }
  }
`;

function RelayTypeTag({ type }: { type: string }) {
  return <span class={`relay-type ${type}`}>{type}</span>;
}

function ConnectionStatus({ connected }: { connected: boolean }) {
  return (
    <div class={`status-indicator ${connected ? "connected" : "disconnected"}`}>
      <span class="status-dot"></span>
      <span class="status-text">
        {connected ? "Connected" : "Disconnected"}
      </span>
    </div>
  );
}

function CombinedAuthStatus({
  authenticated,
  authRequired,
  connected,
}: {
  authenticated: boolean;
  authRequired: boolean;
  connected: boolean;
}) {
  // Don't show auth status if not connected
  if (!connected) {
    return null;
  }

  // If auth is not required, don't show auth status at all
  if (!authRequired) {
    return null;
  }

  // If auth is required, show whether we're authenticated or not
  return (
    <div
      class={`auth-indicator ${authenticated ? "authenticated" : "not-authenticated"}`}
    >
      <span class="auth-text">
        {authenticated ? "🔐 Authenticated" : "🔓 Auth Required"}
      </span>
    </div>
  );
}

async function RelayStatusItem({
  url,
  type,
}: {
  url: string;
  type: "inbox" | "outbox" | "dm";
}) {
  let connected = false;
  let authenticated = false;
  let authRequired = false;

  try {
    const relay = pool.relay(url);
    connected = relay?.connected ?? false;
    authenticated = relay?.authenticated ?? false;

    // Get auth required status from the relay's observable
    if (relay?.authRequiredForRead$) {
      authRequired = await firstValueFrom(relay.authRequiredForRead$);
    }
  } catch (error) {
    // If relay doesn't exist or error accessing it, keep defaults (false)
  }

  return (
    <div class="relay-status-item">
      <div class="relay-info">
        <div class="relay-url">
          <strong>{url}</strong>
          <RelayTypeTag type={type} />
        </div>
      </div>
      <div class="relay-status">
        <ConnectionStatus connected={connected} />
        <CombinedAuthStatus
          authenticated={authenticated}
          authRequired={authRequired}
          connected={connected}
        />
      </div>
    </div>
  );
}

function NoRelaysMessage() {
  return (
    <div class="no-relays">
      <p>No relay connections found. Please configure your settings first.</p>
      <button
        type="button"
        class="btn-primary"
        onclick="window.location.href='/config'"
      >
        Go to Configuration
      </button>
    </div>
  );
}

async function InboxOutboxRelaysList() {
  try {
    // Get the mailboxes to find all relay URLs
    const mailboxes = await firstValueFrom(mailboxes$);

    if (!mailboxes) {
      return (
        <div class="relay-status-list">
          <div class="no-relays">
            <p>
              No inbox/outbox relays found. Please configure your settings
              first.
            </p>
            <button
              type="button"
              class="btn-primary"
              onclick="window.location.href='/config'"
            >
              Go to Configuration
            </button>
          </div>
        </div>
      );
    }

    const relayItems = [];

    // Add inbox relays
    if (mailboxes.inboxes) {
      for (const relayUrl of mailboxes.inboxes) {
        relayItems.push(
          await RelayStatusItem({ url: relayUrl, type: "inbox" }),
        );
      }
    }

    // Add outbox relays
    if (mailboxes.outboxes) {
      for (const relayUrl of mailboxes.outboxes) {
        // Skip if already added as inbox
        if (mailboxes.inboxes?.includes(relayUrl)) continue;

        relayItems.push(
          await RelayStatusItem({ url: relayUrl, type: "outbox" }),
        );
      }
    }

    return (
      <div class="relay-status-list">
        {relayItems.length === 0 ? (
          <div class="no-relays">
            <p>No inbox/outbox relays configured.</p>
          </div>
        ) : (
          relayItems
        )}
      </div>
    );
  } catch (error) {
    console.error("Error loading inbox/outbox relay statuses:", error);
    return (
      <div class="relay-status-list">
        <div class="no-relays">
          <p>Error loading inbox/outbox relay status.</p>
        </div>
      </div>
    );
  }
}

async function DirectMessageRelaysList() {
  try {
    // Get the direct message relays
    const messageInboxes = await firstValueFrom(messageInboxes$);

    if (!messageInboxes || messageInboxes.length === 0) {
      return (
        <div class="relay-status-list">
          <div class="no-relays">
            <p>No direct message relays found.</p>
            <p>
              Direct message relays are configured automatically from your
              NIP-17 relay list.
            </p>
          </div>
        </div>
      );
    }

    const relayItems = [];

    // Add direct message relays
    for (const relayUrl of messageInboxes) {
      relayItems.push(await RelayStatusItem({ url: relayUrl, type: "dm" }));
    }

    return <div class="relay-status-list">{relayItems}</div>;
  } catch (error) {
    console.error("Error loading direct message relay statuses:", error);
    return (
      <div class="relay-status-list">
        <div class="no-relays">
          <p>Error loading direct message relay status.</p>
        </div>
      </div>
    );
  }
}

function StatusPageButtons() {
  return (
    <div class="button-group">
      <button
        type="button"
        class="btn-secondary"
        onclick="window.location.href='/'"
      >
        Back to Home
      </button>
      <button
        type="button"
        class="btn-secondary"
        onclick="window.location.reload()"
      >
        Refresh Status
      </button>
      <button
        type="button"
        class="btn-primary"
        onclick="window.location.href='/config'"
      >
        Configuration
      </button>
    </div>
  );
}

export async function StatusView() {
  return (
    <Document title="Status">
      <Layout
        title="Relay Status"
        subtitle="Current status of relay connections"
      >
        <div class="status-container">
          <div class="status-section">
            <h3>📬 Inbox & Outbox Relays</h3>
            <InboxOutboxRelaysList />
          </div>

          <div class="status-section">
            <h3>💬 Direct Message Relays</h3>
            <DirectMessageRelaysList />
          </div>

          <StatusPageButtons />
        </div>
        <style>{statusPageStyles}</style>
      </Layout>
    </Document>
  );
}

const route: RouterTypes.RouteValue<"/status"> = {
  GET: async () => {
    return new Response(await StatusView(), {
      headers: { "Content-Type": "text/html" },
    });
  },
};

export default route;
