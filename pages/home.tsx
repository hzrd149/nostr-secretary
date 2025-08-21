import type { RouterTypes } from "bun";
import Document from "../components/Document";

export function HomeView() {
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
    return new Response(await HomeView(), {
      headers: { "Content-Type": "text/html" },
    });
  },
};

export default route;
