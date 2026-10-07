import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import type { Plugin } from "vite";

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
