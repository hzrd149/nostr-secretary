import { serve } from "bun";
import configRoute from "./pages/config";
import homeRoute from "./pages/home";
import mobileRoute from "./pages/mobile";

const server = serve({
  port: process.env.PORT ? parseInt(process.env.PORT) : 8080,
  routes: {
    // Static routes
    "/": homeRoute,
    "/config": configRoute,
    "/mobile": mobileRoute,

    "/layout.css": () => new Response(Bun.file("./public/layout.css")),
    "/form.css": () => new Response(Bun.file("./public/form.css")),
    "/button.css": () => new Response(Bun.file("./public/button.css")),
  },
});

console.log(`Server is running on port ${server.port}`);
