// Generate the shipped data-only catalog and optionally extract every inventory icon locally.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
import { readXnbTexture } from "../../packages/assets/dist/index.js";

export const OUTPUT = "packages/assets/src/items/terraria-items.generated.ts";
function fail(message) { throw new Error(`item export: ${message}`); }
const integer = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;

export function exportItems(observed) {
  if (observed.schemaVersion !== 1 || typeof observed.gameVersion !== "string" || !/^[0-9]+(?:\.[0-9]+)+$/.test(observed.gameVersion)
    || !/^[a-f0-9]{64}$/.test(observed.assemblySha256) || !integer(observed.itemCount,1,65536)) fail("invalid observation provenance");
  if (!Array.isArray(observed.items) || observed.items.length !== observed.itemCount) fail("observation must contain every ID");
  if (!Array.isArray(observed.prefixes) || observed.prefixes.length < 1 || observed.prefixes.some((name) => typeof name !== "string")) fail("invalid prefixes");
  for (const [id, item] of observed.items.entries()) {
    if (item.id !== id) fail("invalid ID order");
    if (typeof item.name !== "string" || item.nameStatus !== (id === 0 ? "empty" : item.name.trim() === "" ? "unnamed" : "resolved")) fail(`invalid name status at ID ${id}`);
    if (!Array.isArray(item.symbols) || item.symbols.some((symbol) => typeof symbol !== "string")) fail(`invalid symbols at ID ${id}`);
    if (id === 0) {
      if (item.textureId !== null || item.frame !== null || item.spriteStatus !== "empty") fail("ID 0 must be empty");
    } else {
      if (!integer(item.textureId,1,observed.itemCount-1)) fail(`invalid texture ID at ID ${id}`);
      if (item.spriteStatus === "available") {
        const f = item.frame;
        if (!f || !integer(f.x,0,32768) || !integer(f.y,0,32768) || !integer(f.width,1,32768) || !integer(f.height,1,32768)) fail(`invalid frame at ID ${id}`);
      } else if (item.spriteStatus !== "missing" || item.frame !== null) fail(`invalid sprite status at ID ${id}`);
    }
  }
  // Normalize property order as well as ID order, so PowerShell hashtable enumeration cannot change the module.
  return {
    schemaVersion: 1, gameVersion: observed.gameVersion, assemblySha256: observed.assemblySha256,
    itemCount: observed.itemCount, prefixes: observed.prefixes,
    items: observed.items.map((i) => ({ id:i.id, name:i.name, nameStatus:i.nameStatus, symbols:[...i.symbols].sort(), textureId:i.textureId,
      frame:i.frame === null ? null : { x:i.frame.x, y:i.frame.y, width:i.frame.width, height:i.frame.height }, spriteStatus:i.spriteStatus })),
  };
}

export function cropSprite(sheet, frame) {
  if (!integer(frame.x,0,sheet.width) || !integer(frame.y,0,sheet.height) || !integer(frame.width,1,sheet.width)
    || !integer(frame.height,1,sheet.height) || frame.x+frame.width > sheet.width || frame.y+frame.height > sheet.height
    || sheet.rgba.length !== sheet.width*sheet.height*4) fail("sprite frame is outside sheet bounds");
  const rgba = new Uint8Array(frame.width*frame.height*4);
  for (let y=0; y<frame.height; y++) {
    const start = ((frame.y+y)*sheet.width+frame.x)*4;
    rgba.set(sheet.rgba.subarray(start,start+frame.width*4),y*frame.width*4);
  }
  return { width:frame.width, height:frame.height, rgba };
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit=0; bit<8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(kind, bytes) {
  const result = Buffer.alloc(bytes.length+12);
  result.writeUInt32BE(bytes.length,0); result.write(kind,4,"ascii"); bytes.copy(result,8);
  result.writeUInt32BE(crc32(result.subarray(4,8+bytes.length)),8+bytes.length);
  return result;
}
export function encodePng(sprite) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(sprite.width,0); header.writeUInt32BE(sprite.height,4); header[8]=8; header[9]=6;
  const stride = sprite.width*4, rows = Buffer.alloc((stride+1)*sprite.height);
  for (let y=0; y<sprite.height; y++) rows.set(sprite.rgba.subarray(y*stride,(y+1)*stride),y*(stride+1)+1);
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk("IHDR",header),chunk("IDAT",deflateSync(rows)),chunk("IEND",Buffer.alloc(0))]);
}

export function generateCatalog(assemblyPath, { output=OUTPUT, sprites=null } = {}) {
  const assembly = resolve(assemblyPath), images = join(dirname(assembly),"Content","Images");
  const outputPath = resolve(output), spritePath = sprites === null ? null : resolve(sprites);
  if (spritePath !== null && existsSync(spritePath)) fail("sprite output directory already exists; choose a new directory");
  const scratch = mkdtempSync(join(tmpdir(),"terraria-items-"));
  let stagedSprites = null;
  try {
    const files = new Map();
    for (const file of readdirSync(images).sort()) {
      const match = /^item_(\d+)\.xnb$/i.exec(file);
      if (match === null) continue;
      const id = Number(match[1]);
      if (files.has(id)) fail(`ambiguous item sheet ID ${id}`);
      files.set(id,join(images,file));
    }
    const dimensions = [];
    for (const [id,file] of files) {
      const sheet = readXnbTexture(new Uint8Array(readFileSync(file)));
      dimensions.push({ id,width:sheet.width,height:sheet.height });
    }
    writeFileSync(join(scratch,"dimensions.json"),JSON.stringify(dimensions));
    const observationPath = join(scratch,"observation.json");
    const result = spawnSync(process.platform === "win32" ? "powershell.exe" : "pwsh", ["-NoProfile","-NonInteractive","-ExecutionPolicy","Bypass","-File",
      fileURLToPath(new URL("observe.ps1",import.meta.url)),"-TerrariaAssembly",assembly,"-DimensionsPath",join(scratch,"dimensions.json"),"-OutputPath",observationPath],{ encoding:"utf8",timeout:180000 });
    if (result.status !== 0) fail(result.stderr || result.error?.message || "observer failed");
    const data = exportItems(JSON.parse(readFileSync(observationPath,"utf8")));
    if (spritePath !== null) {
      mkdirSync(dirname(spritePath),{ recursive:true });
      stagedSprites = mkdtempSync(join(dirname(spritePath),".items-staging-"));
    }
    const entries = [];
    for (const item of data.items) {
      if (item.spriteStatus !== "available") {
        entries.push({ id:item.id,status:item.spriteStatus,file:null,reason:item.id === 0 ? "empty item" : `no Item_${item.textureId}.xnb in selected installation` });
        continue;
      }
      const file = files.get(item.textureId) ?? fail(`missing resolved texture for ID ${item.id}`);
      const sheet = readXnbTexture(new Uint8Array(readFileSync(file)));
      const icon = cropSprite(sheet,item.frame);
      const png = encodePng(icon);
      if (stagedSprites !== null) writeFileSync(join(stagedSprites,`Item_${item.id}.png`),png);
      entries.push({ id:item.id,status:"available",file:`Item_${item.id}.png`,textureId:item.textureId,width:icon.width,height:icon.height,
        rgbaSha256:createHash("sha256").update(icon.rgba).digest("hex"),pngSha256:createHash("sha256").update(png).digest("hex") });
    }
    if (stagedSprites !== null) {
      writeFileSync(join(stagedSprites,"manifest.json"),JSON.stringify({ schemaVersion:1,gameVersion:data.gameVersion,assemblySha256:data.assemblySha256,itemCount:data.itemCount,entries },null,2)+"\n");
      renameSync(stagedSprites,spritePath); stagedSprites=null;
    }
    const text = `// Generated by scripts/items/export.mjs from Terraria ${data.gameVersion}. Do not edit by hand.\n// Names and metadata only; sprites stay in the user's local installation. See scripts/items/README.md.\nimport type { ItemCatalog } from "./item-catalog.js";\n\nexport const terrariaItems: ItemCatalog = {\n  schemaVersion: 1,\n  gameVersion: ${JSON.stringify(data.gameVersion)},\n  assemblySha256: ${JSON.stringify(data.assemblySha256)},\n  itemCount: ${data.itemCount},\n  prefixes: ${JSON.stringify(data.prefixes)},\n  items: [\n${data.items.map((item) => `    ${JSON.stringify(item)},`).join("\n")}\n  ],\n};\n`;
    mkdirSync(dirname(outputPath),{ recursive:true });
    writeFileSync(outputPath,text);
    const available = entries.filter((entry) => entry.status === "available").length;
    const missing = entries.filter((entry) => entry.status === "missing").map((entry) => entry.id);
    return { itemCount:data.itemCount,named:data.items.filter((item) => item.nameStatus === "resolved").length,unnamed:data.items.filter((item) => item.nameStatus === "unnamed").map((item) => item.id),available,missing,empty:data.itemCount-available-missing.length,output:outputPath,sprites:spritePath };
  } finally {
    if (stagedSprites !== null) rmSync(stagedSprites,{ recursive:true,force:true });
    rmSync(scratch,{ recursive:true,force:true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [assembly,...options] = process.argv.slice(2);
    if (!assembly || options.length%2 !== 0) fail("usage: node scripts/items/export.mjs <TerrariaServer.exe> [--sprites <new-local-directory>] [--output <module.ts>]");
    const parsed = {};
    for (let index=0; index<options.length; index+=2) {
      if (options[index] === "--sprites") parsed.sprites=options[index+1];
      else if (options[index] === "--output") parsed.output=options[index+1];
      else fail(`unknown option ${options[index]}`);
    }
    console.log(JSON.stringify(generateCatalog(assembly,parsed)));
  } catch (error) { console.error(error.message); process.exitCode=1; }
}
