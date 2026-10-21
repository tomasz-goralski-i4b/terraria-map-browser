import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { readdir, realpath, stat } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

/** Serve only the selected world and direct XNB files. Nothing is copied or written. */
export async function serveLocal(worldPath, imagesPath, port = 0) {
  const world = await realpath(resolve(worldPath));
  const images = await realpath(resolve(imagesPath));
  if (!(await stat(world)).isFile()) throw new Error("Choose a world file.");
  if (!(await stat(images)).isDirectory()) throw new Error("Choose the Content/Images directory.");
  const worldRoute = `/world/${encodeURIComponent(basename(world))}`;
  const sheets = new Map();
  // Do not expose symlinks, nested directories or files added after server startup.
  for (const entry of await readdir(images, { withFileTypes: true })) {
    if (entry.isFile() && /\.xnb$/i.test(entry.name)) sheets.set(`/content/${encodeURIComponent(entry.name)}`, join(images, entry.name));
  }
  // The liquids' water sheets live in Images/Misc; they are listed by their own names, which no Images file shares.
  const misc = join(images, "Misc");
  const miscEntries = await readdir(misc, { withFileTypes: true }).catch(() => []);
  for (const entry of miscEntries) {
    if (entry.isFile() && /^water_\d+\.xnb$/i.test(entry.name)) sheets.set(`/content/${encodeURIComponent(entry.name)}`, join(misc, entry.name));
  }
  const readableSheet = async (path) => {
    const actual = await realpath(path);
    return (dirname(actual) === images || dirname(actual) === misc) && (await stat(actual)).isFile();
  };
  const server = createServer((req, res) => {
    void (async () => {
      const origin = req.headers.origin;
      if (origin !== undefined) {
        let local = false;
        try {
          const url = new URL(origin);
          local = url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
        } catch { /* An invalid Origin is rejected. */ }
        if (!local) { res.writeHead(403); res.end("Only loopback origins are allowed."); return; }
        res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader("Vary", "Origin");
      }
      res.setHeader("Cache-Control", "no-store");
      if (req.method === "OPTIONS") { res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS"); res.writeHead(204); res.end(); return; }
      if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405, { Allow: "GET, HEAD, OPTIONS" }); res.end(); return; }
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (url.pathname === "/content/index.json") {
        const entries = [];
        for (const path of sheets.values()) {
          if (!(await readableSheet(path))) continue;
          const info = await stat(path);
          entries.push({ name: basename(path), size: info.size, lastModified: Math.trunc(info.mtimeMs) });
        }
        res.setHeader("Content-Type", "application/json");
        res.end(req.method === "HEAD" ? undefined : JSON.stringify({ name: "Images", entries }));
        return;
      }
      const path = url.pathname === worldRoute ? world : sheets.get(url.pathname);
      if (path === undefined || (path !== world && !(await readableSheet(path)))) { res.writeHead(404); res.end("Source file not found."); return; }
      res.setHeader("Content-Type", "application/octet-stream");
      res.setHeader("Content-Length", (await stat(path)).size);
      if (req.method === "HEAD") { res.end(); return; }
      const stream = createReadStream(path);
      stream.on("error", () => { res.destroy(); });
      res.on("close", () => { stream.destroy(); });
      stream.pipe(res);
    })().catch(() => {
      if (!res.headersSent) res.writeHead(404);
      res.end("Source file unavailable.");
    });
  });
  await new Promise((resolveListening, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolveListening);
  });
  const address = server.address();
  const origin = `http://127.0.0.1:${address.port}`;
  const worldUrl = `${origin}${worldRoute}`, contentUrl = `${origin}/content/`;
  const query = new URLSearchParams({ world: worldUrl, content: contentUrl, perf: "" });
  return {
    worldUrl, contentUrl, devUrl: `http://localhost:5173/?${query.toString()}`,
    close: () => new Promise((resolveClosed, reject) => {
      server.close((error) => { if (error) reject(error); else resolveClosed(); });
      server.closeAllConnections();
    }),
  };
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [world, images] = process.argv.slice(2);
  if (world === undefined || images === undefined) {
    console.error("Usage: node scripts/dev/serve-local.mjs <world.wld> <Content/Images directory>");
    process.exitCode = 1;
  } else {
    try {
      const local = await serveLocal(world, images);
      console.log(`World: ${local.worldUrl}\nImages: ${local.contentUrl}\nOpen the running Vite dev app: ${local.devUrl}`);
      const stop = () => { void local.close(); };
      process.once("SIGINT", stop); process.once("SIGTERM", stop);
    } catch (error) { console.error(error.message); process.exitCode = 1; }
  }
}
