import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  // Relative asset URLs: the built shell works from any path (root hosting and the offline browser test).
  base: "./",
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: "script",
      manifest: {
        name: "Terraria Map Studio",
        short_name: "Map Studio",
        description: "A local, browser-based editor for Terraria worlds.",
        start_url: ".",
        scope: ".",
        display: "standalone",
        background_color: "#1f2a37",
        theme_color: "#1f2a37",
        icons: [
          { src: "icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
          { src: "icon.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" },
        ],
      },
      // Precache the built app shell only; user files (worlds, assets) are never cached by the service worker.
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,webmanifest}"],
        navigateFallback: "index.html",
      },
    }),
  ],
});
