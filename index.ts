import { serve } from "bun";
import configRoute from "./pages/config";
import homeRoute from "./pages/home";
import messagesRoute from "./pages/messages";
import mobileRoute from "./pages/mobile";
import notificationsRoute from "./pages/notifications";
import statusRoute from "./pages/status";
import signerRoute from "./pages/signer";

// Start listening for notifications
import "./notifications";

const server = serve({
  port: process.env.PORT ? parseInt(process.env.PORT) : 8080,
  routes: {
    // Static routes
    "/": homeRoute,
    "/config": configRoute,
    "/messages": messagesRoute,
    "/mobile": mobileRoute,
    "/notifications": notificationsRoute,
    "/status": statusRoute,
    "/signer": signerRoute,

    // Static files
    "/layout.css": () => new Response(Bun.file("./public/layout.css")),
    "/form.css": () => new Response(Bun.file("./public/form.css")),
    "/button.css": () => new Response(Bun.file("./public/button.css")),
  },
});

console.log(`Server is running on port ${server.port}`);

// Graceful shutdown handling
let isShuttingDown = false;
async function gracefulShutdown(signal: string) {
  if (isShuttingDown) {
    console.log("Force shutdown...");
    process.exit(1);
  }

  isShuttingDown = true;
  console.log(`\nReceived ${signal}, shutting down gracefully...`);

  try {
    console.log("Closing HTTP server...");
    await server.stop();
    process.exit(0);
  } catch (error) {
    console.error("Error during graceful shutdown:", error);
    process.exit(1);
  }
}

// Handle process signals
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

process.on("unhandledRejection", (error) => {
  console.error("Unhandled rejection:", error);
});
process.on("uncaughtException", (error) => {
  console.error("Uncaught exception:", error);
});
