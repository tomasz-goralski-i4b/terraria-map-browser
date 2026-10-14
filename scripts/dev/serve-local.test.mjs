import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { serveLocal } from "./serve-local.mjs";

test("local source server lists direct XNB files, serves exact bytes and limits paths and CORS", async () => {
  const directory = await mkdtemp(join(tmpdir(), "terraria-local-sources-"));
  const images = join(directory, "Content", "Images");
  await mkdir(images, { recursive: true });
  const world = join(directory, "Forest Workshop.wld");
  const bytes = new Uint8Array([0x58, 0x4e, 0x42, 0x77, 5, 0]);
  await writeFile(world, new Uint8Array([0x46, 0x01, 0, 0]));
  await writeFile(join(images, "TIles_650.xnb"), bytes);
  await writeFile(join(images, "TerrariaLogo.png"), bytes);
  await mkdir(join(images, "Unused"));
  await writeFile(join(images, "Unused", "Wall_1.xnb"), bytes);
  let local;
  try {
    local = await serveLocal(world, images);
    assert.equal(new URL(local.worldUrl).hostname, "127.0.0.1");
    const response = await fetch(`${local.contentUrl}index.json`, { headers: { Origin: "http://localhost:5173" } });
    assert.equal(response.headers.get("access-control-allow-origin"), "http://localhost:5173");
    const listing = await response.json();
    assert.equal(listing.name, "Images");
    assert.equal(listing.entries.length, 1);
    assert.equal(listing.entries[0].name, "TIles_650.xnb");
    assert.equal(listing.entries[0].size, bytes.length);
    assert.ok(listing.entries[0].lastModified > 0);
    assert.deepEqual(new Uint8Array(await (await fetch(`${local.contentUrl}TIles_650.xnb`)).arrayBuffer()), bytes);
    assert.deepEqual(new Uint8Array(await (await fetch(local.worldUrl)).arrayBuffer()), new Uint8Array([0x46, 0x01, 0, 0]));
    for (const path of ["Unknown.xnb", "Unused/Wall_1.xnb", "%2e%2e%2fForest%20Workshop.wld", "TerrariaLogo.png"]) {
      assert.equal((await fetch(`${local.contentUrl}${path}`)).status, 404);
    }
    assert.equal((await fetch(local.worldUrl, { headers: { Origin: "https://example.com" } })).status, 403);
    assert.equal((await fetch(local.worldUrl, { method: "POST" })).status, 405);
    assert.ok(local.devUrl.includes("world="));
    assert.ok(local.devUrl.includes("content="));
  } finally { await local?.close(); await rm(directory, { recursive: true, force: true }); }
});

test("the local server rejects symlinked sheets outside Images and invalid input paths", async () => {
  const directory = await mkdtemp(join(tmpdir(), "terraria-local-paths-"));
  const images = join(directory, "Images");
  await mkdir(images);
  const world = join(directory, "ForestWorkshop.wld");
  await writeFile(world, new Uint8Array([0x46, 0x01, 0, 0]));
  let local;
  try {
    await assert.rejects(serveLocal(join(directory, "MissingWorld.wld"), images), /ENOENT/);
    await assert.rejects(serveLocal(world, world), /Images|directory/i);
    try { await symlink(world, join(images, "Tiles_0.xnb")); }
    catch (error) { if (error.code !== "EPERM") throw error; return; }
    local = await serveLocal(world, images);
    assert.equal((await fetch(`${local.contentUrl}Tiles_0.xnb`)).status, 404);
    assert.equal((await (await fetch(`${local.contentUrl}index.json`)).json()).entries.length, 0);
  } finally { await local?.close(); await rm(directory, { recursive: true, force: true }); }
});
