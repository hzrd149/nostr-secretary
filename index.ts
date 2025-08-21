import { serve } from "bun";
import configRoute from "./pages/config";
import homeRoute from "./pages/home";

const server = serve({
  port: process.env.PORT ? parseInt(process.env.PORT) : 8080,
  routes: {
    // Static routes
    "/": homeRoute,
    "/config": configRoute,
  },

  // (optional) fallback for unmatched routes:
  // Required if Bun's version < 1.2.3
  fetch(req) {
    return new Response("Not Found", { status: 404 });
  },
});

console.log(`Server is running on port ${server.port}`);
