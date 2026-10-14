import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import type { Plugin } from "vite";
import { buildTexturePayload, patternRgba, wrapUncompressed } from "@studio/assets/testing";
import { brushSource } from "./brush-source.js";

// Test tooling for the offline PWA test: serves the production build (apps/web/dist, relative base) under
// /pwa-app/ on the Vitest browser server, so a real service worker can register with scope /pwa-app/.
// `setDistServerOffline(true)` makes it fail every request, simulating a lost network.
export const DIST_MOUNT = "/pwa-app/";

const contentTypes: Readonly<Record<string, string>> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json",
};

let offline = false;

export function setDistServerOffline(value: boolean): void {
  offline = value;
}

export function distServer(distDir: string): Plugin {
  return {
    name: "studio-dist-server",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = new URL(req.url ?? "/", "http://localhost");
        // Real HTTP source fixtures: generated world and texture bytes, never game assets.
        if (url.pathname.startsWith("/source-fixtures/")) {
          res.setHeader("Cache-Control", "no-store");
          if (url.pathname === "/source-fixtures/ForestWorkshop.wld") {
            res.end(brushSource(120, 80, Array.from({ length: 120 }, () => [0x42, 0, 79]).flat()));
          } else if (url.pathname === "/source-fixtures/content/index.json") {
            const sheet = wrapUncompressed(buildTexturePayload(288, 270, patternRgba(288, 270)));
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ name: "Images", entries: [{ name: "Tiles_0.xnb", size: sheet.length, lastModified: 1700000000000 }] }));
          } else if (url.pathname === "/source-fixtures/content/Tiles_0.xnb") {
            res.end(wrapUncompressed(buildTexturePayload(288, 270, patternRgba(288, 270))));
          } else { res.statusCode = 404; res.end(); }
          return;
        }
        if (!url.pathname.startsWith(DIST_MOUNT)) {
          next();
          return;
        }
        if (offline) {
          req.socket.destroy();
          return;
        }
        const relative = decodeURIComponent(url.pathname.slice(DIST_MOUNT.length)) || "index.html";
        const file = normalize(join(distDir, relative));
        if (!file.startsWith(distDir) || !existsSync(file) || !statSync(file).isFile()) {
          res.statusCode = 404;
          res.end();
          return;
        }
        res.setHeader("Content-Type", contentTypes[extname(file)] ?? "application/octet-stream");
        res.setHeader("Cache-Control", "no-store");
        createReadStream(file).pipe(res);
      });
    },
  };
}
