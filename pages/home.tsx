import type { RouterTypes } from "bun";
import Document from "../components/Document";
import config from "../services/config";
import { normalizeToPubkey } from "applesauce-core/helpers";

export function HomeView({
  showNpubForm = false,
  error = "",
}: { showNpubForm?: boolean; error?: string } = {}) {
  if (showNpubForm) {
    return (
      <Document title="Nostr Secretary - Setup">
        <div class="home-container">
          <h1>Nostr Secretary</h1>
          <p>Welcome! Please enter your Nostr npub to get started.</p>

          {error && (
            <div
              class="error-message"
              style="color: red; margin: 10px 0; padding: 10px; border: 1px solid red; border-radius: 4px; background-color: #ffe6e6;"
            >
              {error}
            </div>
          )}

          <form
            method="POST"
            action="/"
            class="npub-form"
            style="margin: 20px 0;"
          >
            <div style="margin-bottom: 15px;">
              <label
                for="npub"
                style="display: block; margin-bottom: 5px; font-weight: bold;"
              >
                Your Nostr npub:
              </label>
              <input
                type="text"
                id="npub"
                name="npub"
                placeholder="npub1..."
                required
                style="width: 100%; max-width: 500px; padding: 8px; border: 1px solid #ccc; border-radius: 4px; font-family: monospace;"
              />
              <small style="display: block; margin-top: 5px; color: #666;">
                Your npub starts with "npub1" and can be found in your Nostr
                client settings.
              </small>
            </div>
            <button
              type="submit"
              style="background-color: #007bff; color: white; padding: 10px 20px; border: none; border-radius: 4px; cursor: pointer; font-size: 16px;"
            >
              Save Configuration
            </button>
          </form>
        </div>
      </Document>
    );
  }

  return (
    <Document title="Nostr Secretary">
      <div class="home-container">
        <h1>Nostr Secretary</h1>
        <p>Your personal Nostr assistant</p>

        <div class="nav-links">
          <a href="/config" class="nav-link">
            ⚙️ Configuration
          </a>
        </div>
      </div>
    </Document>
  );
}

const route: RouterTypes.RouteValue<"/"> = {
  GET: async () => {
    const currentConfig = config.getValue();
    const showNpubForm = !currentConfig.user;

    return new Response(await HomeView({ showNpubForm }), {
      headers: { "Content-Type": "text/html" },
    });
  },

  POST: async (req) => {
    try {
      const formData = await req.formData();
      const npub = formData.get("npub")?.toString()?.trim();

      if (!npub) {
        return new Response(
          await HomeView({
            showNpubForm: true,
            error: "Please enter your npub",
          }),
          {
            headers: { "Content-Type": "text/html" },
            status: 400,
          },
        );
      }

      const hexPubkey = normalizeToPubkey(npub);
      if (!hexPubkey) {
        return new Response(
          await HomeView({
            showNpubForm: true,
            error:
              "Invalid npub format. Please make sure it starts with 'npub1'",
          }),
          {
            headers: { "Content-Type": "text/html" },
            status: 400,
          },
        );
      }

      // Update config with the new pubkey
      const currentConfig = config.getValue();
      config.next({ ...currentConfig, user: hexPubkey });

      // Redirect to home page (GET request) to show the main interface
      return new Response("", {
        status: 302,
        headers: { Location: "/" },
      });
    } catch (error) {
      console.error("Error processing npub:", error);
      return new Response(
        await HomeView({
          showNpubForm: true,
          error:
            "An error occurred while processing your npub. Please try again.",
        }),
        {
          headers: { "Content-Type": "text/html" },
          status: 500,
        },
      );
    }
  },
};

export default route;
