import assert from "node:assert/strict";
import { test } from "node:test";
import { crc32, inflateSync } from "node:zlib";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { terrariaItems } from "../../packages/assets/src/items/terraria-items.generated.ts";
import { exportItems, cropSprite, encodePng, generateCatalog } from "./export.mjs";

// The generated runtime catalog is the fixture: real item IDs, aliases and the real unnamed runtime ID.
const observation = () => structuredClone(terrariaItems);

test("unnamed pickup IDs remain explicit catalog entries", () => {
  const reserved = observation();
  const data = exportItems(reserved);
  assert.equal(data.items[4143].id, 4143);
  assert.equal(data.items[4143].nameStatus, "unnamed");
  assert.deepEqual(data.items[4143].symbols, ["ManaCloakStar"]);
});

test("catalog retains every ID, aliases, prefixes and explicit missing sprites", () => {
  const localContent = observation();
  // Simulate an installation with a missing Stone Block sheet, keeping the item itself.
  localContent.items[3].spriteStatus = "missing"; localContent.items[3].frame = null;
  const data = exportItems(localContent);
  assert.equal(data.items.length, 6196);
  assert.equal(data.items[2].textureId, 2);
  assert.equal(data.items[3665].textureId, 48);
  assert.equal(data.items[3].spriteStatus, "missing");
  assert.equal(data.prefixes[55], "Unpleasant");
});

test("complete catalog and all sprite crops equal a fresh game observation", {
  skip: !process.env.TERRARIA_ASSEMBLY && "set TERRARIA_ASSEMBLY to a local TerrariaServer.exe",
}, async () => {
  const directory = mkdtempSync(join(tmpdir(),"terraria-items-conformance-"));
  try {
    const output = join(directory,"terraria-items.generated.ts"), sprites = join(directory,"icons");
    const result = generateCatalog(process.env.TERRARIA_ASSEMBLY,{ output,sprites });
    assert.equal(result.itemCount,6196); assert.equal(result.available,6195);
    assert.deepEqual(result.missing,[]); assert.deepEqual(result.unnamed,[4143]);
    const fresh = (await import(pathToFileURL(output).href)).terrariaItems;
    assert.deepEqual(fresh,terrariaItems);
    assert.throws(() => generateCatalog(process.env.TERRARIA_ASSEMBLY,{ output,sprites }), /already exists/);
  } finally { rmSync(directory,{ recursive:true,force:true }); }
});

test("incomplete or inconsistent observations cannot silently omit an ID", () => {
  const missing = observation(); missing.items.splice(2, 1);
  assert.throws(() => exportItems(missing), /every ID/);
  const duplicate = observation(); duplicate.items[2].id = 1;
  assert.throws(() => exportItems(duplicate), /ID order/);
  const unnamed = observation(); unnamed.items[1].name = "";
  assert.throws(() => exportItems(unnamed), /name/);
  const invalid = observation(); invalid.items[1].frame.width = 0;
  assert.throws(() => exportItems(invalid), /frame/);
});

test("animated frame crop retains row order and alpha; PNG contains precisely those pixels", () => {
  // A two-frame Soul of Light strip with a gutter: extract the second frame, not the full strip.
  const sheet = { width: 2, height: 5, rgba: Uint8Array.from([
    255,180,255,255, 180,100,255,128, 120,50,210,255, 80,20,150,64,
    0,0,0,0, 0,0,0,0,
    255,230,255,255, 220,140,255,128, 180,80,230,255, 100,40,180,64,
  ]) };
  const sprite = cropSprite(sheet, { x: 0, y: 3, width: 2, height: 2 });
  assert.deepEqual(sprite.rgba, sheet.rgba.slice(24));
  const png = encodePng(sprite);
  assert.deepEqual([...png.subarray(0,8)], [137,80,78,71,13,10,26,10]);
  let position = 8; const chunks = [];
  while (position < png.length) {
    const size = png.readUInt32BE(position), kind = png.toString("ascii", position+4, position+8);
    assert.equal(png.readUInt32BE(position+8+size),crc32(png.subarray(position+4,position+8+size)));
    if (kind === "IHDR") { assert.equal(png.readUInt32BE(position+8), 2); assert.equal(png.readUInt32BE(position+12), 2); }
    if (kind === "IDAT") chunks.push(png.subarray(position+8,position+8+size));
    position += size+12;
  }
  const rows = inflateSync(Buffer.concat(chunks));
  assert.equal(rows[0], 0); assert.equal(rows[9], 0);
  assert.deepEqual(Buffer.concat([rows.subarray(1,9), rows.subarray(10,18)]), Buffer.from(sprite.rgba));
  assert.throws(() => cropSprite(sheet, { x: 0, y: 4, width: 2, height: 2 }), /bounds/);
});
