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
        background_color: "#16181d",
        theme_color: "#16181d",
        icons: [
          { src: "brand/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "brand/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "brand/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      // Precache the built app shell only; user files (worlds, assets) are never cached by the service worker.
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,webp,webmanifest}"],
        navigateFallback: "index.html",
      },
    }),
  ],
});
