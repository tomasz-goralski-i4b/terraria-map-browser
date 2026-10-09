// Temporary (vitest.real-art.config.ts): a local world with the local art on the real GPU. Not committed.
import { beforeAll, test } from "vitest";
import { commands } from "vitest/browser";
import { readWorldTiles } from "../../world-codec/src/index.js";
import { createBlockFraming, createMapRenderer, loadFramingDatabase, terrariaFramingData } from "../src/index.js";
import type { BlockFraming, SpriteAtlasSource, SpriteSheetEntry } from "../src/index.js";

interface Commands {
  readWorld: (file: string) => Promise<string>;
  writePng: (name: string, base64: string) => Promise<void>;
  atlas: (tiles: number[], walls: number[]) => Promise<{ pageSize: number; entries: SpriteSheetEntry[]; pages: string[] }>;
}
const local = commands as unknown as Commands;

let framing: BlockFraming;
beforeAll(async () => {
  framing = createBlockFraming(await loadFramingDatabase(terrariaFramingData));
});

const bytes = (base64: string): Uint8Array => Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));

test("render", async () => {
  const world = readWorldTiles(bytes(await local.readWorld("painting.wld")));
  const { width, height } = world.metadata;
  const surface = Math.round((world.metadata as unknown as { surfaceLevel?: number }).surfaceLevel ?? height * 0.3);
  const tiles = new Set<number>();
  const walls = new Set<number>();
  const left = Math.floor(width / 2 - 42);
  for (let x = left; x < left + 120; x++) {
    for (let y = surface + 28; y < surface + 95; y++) {
      const block = world.palette[world.planes.block[x * height + y] ?? 0xffff];
      const wall = world.palette[world.planes.wall[x * height + y] ?? 0xffff];
      if (block?.kind === "vanilla") tiles.add(block.id);
      if (wall?.kind === "vanilla") walls.add(wall.id);
    }
  }
  const source = await local.atlas([...tiles], [...walls]);
  const atlas: SpriteAtlasSource = { pages: source.pages.map(bytes), index: { pageSize: source.pageSize, entries: source.entries } };
  const canvas = document.createElement("canvas");
  canvas.width = 900;
  canvas.height = 500;
  const renderer = createMapRenderer(canvas, { maxCachedChunks: 64 });
  renderer.setWorld({ width, height, surfaceY: surface, planes: world.planes as never, palette: world.palette as never });
  renderer.setAtlas(atlas);
  renderer.setFraming(framing);
  renderer.setSpriteMode(true);
  const tag = (globalThis as { location?: Location }).location?.search.includes("old") === true ? "old" : "new";
  for (const zoom of [8.1, 12]) {
    renderer.setCamera({ x: width / 2 - 40, y: surface + 30, zoom });
    renderer.render();
    const url = canvas.toDataURL("image/png");
    await local.writePng(`painting-${String(zoom)}-${tag}.png`, url.slice(url.indexOf(",") + 1));
  }
  renderer.dispose();
});
