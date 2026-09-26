import { createFileRoute } from "@tanstack/react-router";
// The app is a standalone HTML/CSS/vanilla-JS project in public/app.
// The root URL serves its shell directly — no React renders on this page.
import shell from "../../public/app/index.html?raw";

export const Route = createFileRoute("/")({
  server: {
    handlers: {
      GET: () =>
        new Response(shell, {
          headers: {
            "content-type": "text/html; charset=utf-8",
            "cache-control": "no-cache",
          },
        }),
    },
  },
});
