import type { RouterTypes } from "bun";
import { firstValueFrom } from "rxjs";
import Document from "../components/Document";
import Layout from "../components/Layout";
import * as messagesNotification from "../notifications/messages";
import * as repliesNotification from "../notifications/replies";
import * as zapsNotification from "../notifications/zaps";
import * as groupsNotification from "../notifications/groups";

const notificationStyles = `
  .notifications-container {
    max-width: 800px;
    margin: 0 auto;
  }

  .notification-section {
    margin-bottom: 2rem;
  }

  .notification-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 1.5rem;
    background: white;
    border-radius: 8px;
    border: 1px solid #dee2e6;
    margin-bottom: 1rem;
    box-shadow: 0 2px 4px rgba(0,0,0,0.1);
  }

  .notification-info {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    flex: 1;
  }

  .notification-name {
    font-weight: 600;
    color: #495057;
    font-size: 1.1rem;
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .notification-description {
    font-size: 0.9rem;
    color: #6c757d;
    line-height: 1.4;
  }

  .notification-actions {
    display: flex;
    gap: 1rem;
    align-items: center;
  }

  .notification-status {
    font-weight: 600;
    font-size: 0.9rem;
    padding: 0.5rem 1rem;
    border-radius: 6px;
    text-transform: uppercase;
    min-width: 80px;
    text-align: center;
  }

  .notification-status.enabled {
    background: #d4edda;
    color: #155724;
    border: 1px solid #c3e6cb;
  }

  .notification-status.disabled {
    background: #f8d7da;
    color: #721c24;
    border: 1px solid #f5c6cb;
  }

  .config-btn {
    font-size: 0.9rem;
    padding: 0.6rem 1.2rem;
    background: #007bff;
    color: white;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    text-decoration: none;
    display: inline-block;
    font-weight: 500;
    transition: background-color 0.2s;
  }

  .config-btn:hover {
    background: #0056b3;
    text-decoration: none;
    color: white;
  }

  .overview-stats {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 1rem;
    margin-bottom: 2rem;
  }

  .stat-card {
    background: white;
    padding: 1.5rem;
    border-radius: 8px;
    border: 1px solid #dee2e6;
    text-align: center;
    box-shadow: 0 2px 4px rgba(0,0,0,0.1);
  }

  .stat-number {
    font-size: 2rem;
    font-weight: 700;
    margin-bottom: 0.5rem;
  }

  .stat-number.enabled {
    color: #28a745;
  }

  .stat-number.disabled {
    color: #dc3545;
  }

  .stat-label {
    font-size: 0.9rem;
    color: #6c757d;
    text-transform: uppercase;
    font-weight: 500;
  }

  @media (max-width: 768px) {
    .notification-item {
      flex-direction: column;
      align-items: flex-start;
      gap: 1rem;
    }

    .notification-actions {
      width: 100%;
      justify-content: space-between;
    }

    .overview-stats {
      grid-template-columns: 1fr;
    }
  }
`;

async function NotificationOverview() {
  const messagesEnabled = await firstValueFrom(
    messagesNotification.enabled$,
  ).catch(() => false);
  const repliesEnabled = await firstValueFrom(
    repliesNotification.enabled$,
  ).catch(() => false);
  const zapsEnabled = await firstValueFrom(zapsNotification.enabled$).catch(
    () => false,
  );

  const totalEnabled = [messagesEnabled, repliesEnabled, zapsEnabled].filter(
    Boolean,
  ).length;
  const totalNotifications = 3;

  return (
    <div class="overview-stats">
      <div class="stat-card">
        <div class={`stat-number ${totalEnabled > 0 ? "enabled" : "disabled"}`}>
          {totalEnabled}
        </div>
        <div class="stat-label">Enabled</div>
      </div>
      <div class="stat-card">
        <div
          class={`stat-number ${totalNotifications - totalEnabled > 0 ? "disabled" : "enabled"}`}
        >
          {totalNotifications - totalEnabled}
        </div>
        <div class="stat-label">Disabled</div>
      </div>
      <div class="stat-card">
        <div class="stat-number" style="color: #495057;">
          {totalNotifications}
        </div>
        <div class="stat-label">Total Types</div>
      </div>
    </div>
  );
}

async function NotificationsList() {
  const messagesEnabled = await firstValueFrom(
    messagesNotification.enabled$,
  ).catch(() => false);
  const repliesEnabled = await firstValueFrom(
    repliesNotification.enabled$,
  ).catch(() => false);
  const zapsEnabled = await firstValueFrom(zapsNotification.enabled$).catch(
    () => false,
  );
  const groupsEnabled = await firstValueFrom(groupsNotification.enabled$).catch(
    () => false,
  );

  return (
    <div class="notification-section">
      <div class="notification-item">
        <div class="notification-info">
          <div class="notification-name">💬 Direct Messages</div>
          <div class="notification-description">
            Get notified when you receive private messages (NIP-04 & NIP-17).
            Configure whitelists, blacklists, and content privacy settings.
          </div>
        </div>
        <div class="notification-actions">
          <span
            class={`notification-status ${messagesEnabled ? "enabled" : "disabled"}`}
          >
            {messagesEnabled ? "Enabled" : "Disabled"}
          </span>
          <a href="/messages" class="config-btn">
            Configure
          </a>
        </div>
      </div>

      <div class="notification-item">
        <div class="notification-info">
          <div class="notification-name">💬 Replies</div>
          <div class="notification-description">
            Get notified when someone replies to your notes. Helps you stay
            engaged in conversations.
          </div>
        </div>
        <div class="notification-actions">
          <span
            class={`notification-status ${repliesEnabled ? "enabled" : "disabled"}`}
          >
            {repliesEnabled ? "Enabled" : "Disabled"}
          </span>
          <a href="/replies" class="config-btn">
            Configure
          </a>
        </div>
      </div>

      <div class="notification-item">
        <div class="notification-info">
          <div class="notification-name">⚡ Zaps</div>
          <div class="notification-description">
            Get notified when someone zaps your notes or profile. Stay updated
            on your Lightning Network tips.
          </div>
        </div>
        <div class="notification-actions">
          <span
            class={`notification-status ${zapsEnabled ? "enabled" : "disabled"}`}
          >
            {zapsEnabled ? "Enabled" : "Disabled"}
          </span>
          <a href="/zaps" class="config-btn">
            Configure
          </a>
        </div>
      </div>

      <div class="notification-item">
        <div class="notification-info">
          <div class="notification-name">👥 Groups</div>
          <div class="notification-description">
            Get notified about activity in your NIP-29 groups (channels).
            Configure group-specific whitelists and blacklists.
          </div>
        </div>
        <div class="notification-actions">
          <span
            class={`notification-status ${groupsEnabled ? "enabled" : "disabled"}`}
          >
            {groupsEnabled ? "Enabled" : "Disabled"}
          </span>
          <a href="/groups" class="config-btn">
            Configure
          </a>
        </div>
      </div>
    </div>
  );
}

export async function NotificationsView() {
  return (
    <Document title="Notifications">
      <Layout
        title="Notification Settings"
        subtitle="Configure how you receive notifications for different Nostr events"
      >
        <div class="notifications-container">
          <NotificationOverview />
          <NotificationsList />

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
              class="btn-primary"
              onclick="window.location.href='/config'"
            >
              General Configuration
            </button>
          </div>
        </div>
        <style>{notificationStyles}</style>
      </Layout>
    </Document>
  );
}

const route: RouterTypes.RouteValue<"/notifications"> = {
  GET: async () => {
    return new Response(await NotificationsView(), {
      headers: { "Content-Type": "text/html" },
    });
  },
};

export default route;
