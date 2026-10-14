import type { ContentFolder } from "./assets/asset-session.js";
import { isAtlasSheetName } from "@studio/assets";

export interface WorldSource {
  readonly name: string;
  read(signal: AbortSignal): Promise<File>;
}

export interface AssetSource {
  readonly name: string;
  read(signal: AbortSignal): Promise<ContentFolder | readonly File[]>;
}

export function fileWorldSource(file: File): WorldSource {
  return { name: file.name, read: async (signal) => { signal.throwIfAborted(); return Promise.resolve(file); } };
}

export function folderAssetSource(folder: ContentFolder): AssetSource {
  return { name: folder.name, read: async (signal) => { signal.throwIfAborted(); return Promise.resolve(folder); } };
}

export function filesAssetSource(files: readonly File[], name: string): AssetSource {
  return { name, read: async (signal) => { signal.throwIfAborted(); return Promise.resolve(files.filter((file) => isAtlasSheetName(file.name))); } };
}

/** Redirects are forbidden too: a loopback URL must never turn into a remote request. */
function loopbackUrl(value: string): URL {
  let url: URL;
  try { url = new URL(value); }
  catch { throw new Error("Sources accept only HTTP loopback URLs: localhost, 127.0.0.1 or [::1]."); }
  if (url.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || url.username !== "" || url.password !== "") {
    throw new Error("Sources accept only HTTP loopback URLs: localhost, 127.0.0.1 or [::1].");
  }
  return url;
}

async function fetchLocal(url: URL, signal: AbortSignal): Promise<Response> {
  signal.throwIfAborted();
  const response = await fetch(url.href, { signal, redirect: "error" });
  if (!response.ok) throw new Error(`HTTP ${String(response.status)} loading ${url.pathname}`);
  return response;
}

export function httpWorldSource(value: string): WorldSource {
  const url = loopbackUrl(value);
  const name = decodeURIComponent(url.pathname.split("/").at(-1) ?? "") || "LocalWorld.wld";
  return { name, read: async (signal) => new File([await (await fetchLocal(url, signal)).arrayBuffer()], name) };
}

interface ListingEntry { readonly name: string; readonly size: number; readonly lastModified: number }

function listingEntries(value: unknown): readonly ListingEntry[] {
  const invalid = (): Error => new Error("Invalid Images listing: expected unique direct file names, sizes and lastModified timestamps.");
  if (typeof value !== "object" || value === null || !("entries" in value) || !Array.isArray(value.entries)) throw invalid();
  const names = new Set<string>();
  return value.entries.map((entry: unknown) => {
    if (typeof entry !== "object" || entry === null || !("name" in entry) || typeof entry.name !== "string"
      || !/^[A-Za-z0-9_. -]+$/.test(entry.name) || entry.name === "." || entry.name === ".."
      || !("size" in entry) || typeof entry.size !== "number" || !Number.isSafeInteger(entry.size) || entry.size < 0
      || !("lastModified" in entry) || typeof entry.lastModified !== "number" || !Number.isSafeInteger(entry.lastModified) || entry.lastModified < 0
      || names.has(entry.name.toLowerCase())) throw invalid();
    names.add(entry.name.toLowerCase());
    return { name: entry.name, size: entry.size, lastModified: entry.lastModified };
  });
}

export function httpAssetSource(value: string): AssetSource {
  const base = loopbackUrl(value);
  base.search = ""; base.hash = "";
  if (!base.pathname.endsWith("/")) base.pathname += "/";
  return {
    name: "HTTP Images",
    read: async (signal) => {
      const listing: unknown = await (await fetchLocal(new URL("index.json", base), signal)).json();
      const entries = listingEntries(listing).filter((entry) => isAtlasSheetName(entry.name));
      const files: File[] = [];
      // Bound concurrent downloads even for a full installation with thousands of sheets.
      let next = 0;
      const download = async (): Promise<void> => {
        for (let index = next++; index < entries.length; index = next++) {
          const entry = entries[index];
          if (entry === undefined) continue;
          const bytes = await (await fetchLocal(new URL(encodeURIComponent(entry.name), base), signal)).arrayBuffer();
          if (bytes.byteLength !== entry.size) throw new Error(`Images listing size changed for ${entry.name}; reload the directory.`);
          files[index] = new File([bytes], entry.name, { lastModified: entry.lastModified });
        }
      };
      await Promise.all(Array.from({ length: Math.min(4, entries.length) }, download));
      return files;
    },
  };
}

export function devSources(search: string, development: boolean): { world: WorldSource; assets: AssetSource } | null {
  if (!development) return null;
  const params = new URLSearchParams(search);
  if (!params.has("world") && !params.has("content")) return null;
  const world = params.get("world"), content = params.get("content");
  if (world === null || content === null || world === "" || content === "") throw new Error("Provide both world and content URLs.");
  return { world: httpWorldSource(world), assets: httpAssetSource(content) };
}
