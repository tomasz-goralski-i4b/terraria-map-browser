import { afterEach, expect, test, vi } from "vitest";
import { devSources, fileWorldSource, filesAssetSource, folderAssetSource, httpAssetSource, httpWorldSource } from "../src/sources.js";
import type { ContentFolder } from "../src/assets/asset-session.js";
import { brushSource } from "./support/brush-source.js";

afterEach(() => { vi.restoreAllMocks(); });
const signal = new AbortController().signal;

test("the file input and dropped worlds share the world source contract", async () => {
  const file = new File([brushSource()], "ForestWorkshop.wld");
  const source = fileWorldSource(file);
  expect(source.name).toBe(file.name);
  expect(await source.read(signal)).toBe(file);
});

test("folder and fallback files implement the atlas source contract", async () => {
  const folder = { name: "Content" } as ContentFolder;
  expect(await folderAssetSource(folder).read(signal)).toBe(folder);
  const sheet = new File([new Uint8Array([0x58, 0x4e, 0x42])], "TIles_650.xnb");
  expect(await filesAssetSource([sheet, new File([], "TerrariaLogo.png")], "Content").read(signal)).toEqual([sheet]);
});

test("HTTP world preserves its file name and bytes and forbids redirects", async () => {
  const bytes = brushSource();
  const fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(bytes));
  const source = httpWorldSource("http://localhost:8123/world/Forest%20Workshop.wld");
  const file = await source.read(signal);
  expect(file.name).toBe("Forest Workshop.wld");
  expect(new Uint8Array(await file.arrayBuffer())).toEqual(bytes);
  expect(fetcher).toHaveBeenCalledWith("http://localhost:8123/world/Forest%20Workshop.wld", { signal, redirect: "error" });
});

test("HTTP Content/Images listing fetches only atlas sheets and preserves cache metadata", async () => {
  const fetcher = vi.spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(Response.json({ name: "Images", entries: [
      { name: "TIles_650.xnb", size: 3, lastModified: 1700000000000 },
      { name: "Wall_1.xnb", size: 3, lastModified: 1700000000001 },
      { name: "TerrariaLogo.png", size: 7, lastModified: 1700000000002 },
    ] }))
    .mockResolvedValue(new Response(new Uint8Array([0x58, 0x4e, 0x42])));
  const result = await httpAssetSource("http://127.0.0.1:8123/content/").read(signal);
  expect(Array.isArray(result)).toBe(true);
  const files = result as readonly File[];
  expect(files.map((file) => [file.name, file.size, file.lastModified])).toEqual([
    ["TIles_650.xnb", 3, 1700000000000], ["Wall_1.xnb", 3, 1700000000001],
  ]);
  expect(fetcher).toHaveBeenCalledTimes(3);
});

test.each(["https://localhost/world.wld", "http://example.com/world.wld", "http://localhost.example.com/world.wld", "http://192.168.1.10/world.wld", "file:///C:/Worlds/Forest.wld", "http://user:password@localhost/world.wld"])("rejects non-local HTTP source %s before fetching", (url) => {
  const fetcher = vi.spyOn(globalThis, "fetch");
  expect(() => httpWorldSource(url)).toThrow(/localhost|loopback/i);
  expect(() => httpAssetSource(url)).toThrow(/localhost|loopback/i);
  expect(fetcher).not.toHaveBeenCalled();
});

test.each(["localhost", "127.0.0.1", "[::1]"])("the dev hook accepts HTTP on %s", (host) => {
  const params = new URLSearchParams({ world: `http://${host}:8123/ForestWorkshop.wld`, content: `http://${host}:8123/content/` });
  expect(devSources(params.toString(), true)?.world.name).toBe("ForestWorkshop.wld");
});

test("production ignores URL parameters, including invalid URLs, without fetching", () => {
  const fetcher = vi.spyOn(globalThis, "fetch");
  expect(devSources("?world=http://example.com/Forest.wld&content=invalid", false)).toBeNull();
  expect(devSources("", true)).toBeNull();
  expect(fetcher).not.toHaveBeenCalled();
});

test("the hook requires both sources and validates both before loading", () => {
  expect(() => devSources("?world=http://localhost/Forest.wld", true)).toThrow(/world.*content/i);
  expect(() => devSources("?world=http://localhost/Forest.wld&content=http://example.com/content/", true)).toThrow(/localhost|loopback/i);
});

test.each(["../Tiles_0.xnb", "http://example.com/Tiles_0.xnb", "Images/Tiles_0.xnb", "Tiles_0.xnb?redirect=remote", "Tiles_0.xnb\\..\\Wall_1.xnb"])("rejects unsafe listing entry %s before any sheet fetch", async (name) => {
  const fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ name: "Images", entries: [{ name, size: 3, lastModified: 1700000000000 }] }));
  await expect(httpAssetSource("http://localhost:8123/content/").read(signal)).rejects.toThrow(/listing/i);
  expect(fetcher).toHaveBeenCalledTimes(1);
});

test("HTTP failures and malformed listings report an actionable error", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(null, { status: 404 })).mockResolvedValueOnce(Response.json({ entries: "missing directory" }));
  await expect(httpWorldSource("http://localhost:8123/Forest.wld").read(signal)).rejects.toThrow(/404/);
  await expect(httpAssetSource("http://localhost:8123/content/").read(signal)).rejects.toThrow(/listing/i);
});

test("a cancelled local source cannot start a parse or atlas build", async () => {
  const cancelled = new AbortController();
  cancelled.abort();
  await expect(fileWorldSource(new File([brushSource()], "ForestWorkshop.wld")).read(cancelled.signal)).rejects.toThrow(/abort/i);
  await expect(filesAssetSource([], "Images").read(cancelled.signal)).rejects.toThrow(/abort/i);
  await expect(folderAssetSource({ name: "Content" } as ContentFolder).read(cancelled.signal)).rejects.toThrow(/abort/i);
});
