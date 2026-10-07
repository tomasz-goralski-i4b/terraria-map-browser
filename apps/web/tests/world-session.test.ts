import { beforeEach, describe, expect, test, vi } from "vitest";
import { parseMapPalette } from "@studio/renderer";
import { WorldWorkerError, type WorldTilesResult } from "@studio/world-codec";
import { useAppStore } from "../src/store.js";
import { createWorldSession, type WorldParser } from "../src/world/world-session.js";

function fakeWorld(name: string, width = 4200, height = 1200): WorldTilesResult {
  return {
    header: { version: 326 },
    metadata: { name, seed: "42", guid: "g", worldId: 1, width, height, mode: "expert", evil: "crimson" },
    palette: [{ kind: "vanilla", id: 1 }, { kind: "vanilla", id: 2 }, { kind: "vanilla", id: 3 }],
    planes: {},
  } as unknown as WorldTilesResult;
}

interface Deferred {
  readonly resolve: (world: WorldTilesResult) => void;
  readonly reject: (error: unknown) => void;
}

/** A parser whose requests settle only when the test says so; honours the abort signal like the real client. */
function controllableParser(): { parser: WorldParser; requests: Deferred[] } {
  const requests: Deferred[] = [];
  const parser: WorldParser = {
    parse: (_file, options) =>
      new Promise<WorldTilesResult>((resolve, reject) => {
        requests.push({ resolve, reject });
        options?.signal?.addEventListener("abort", () => {
          reject(new WorldWorkerError(1, { code: "Cancelled", offset: 0, message: "aborted" }));
        });
      }),
  };
  return { parser, requests };
}

const file = (name: string): File => new File([new Uint8Array(4)], name);

beforeEach(() => {
  useAppStore.setState({ phase: "idle", loadingFileName: null, summary: null, error: null });
});

describe("world session", () => {
  test("opening each world invokes the local palette importer without a .NET call", async () => {
    const palette = parseMapPalette(JSON.stringify({
      schemaVersion: 1, gameVersion: "1.4.5.8",
      tiles: [[[118, 88, 62]], [[108, 112, 120]]], walls: [[], [[82, 86, 92]]],
      liquids: [[32, 104, 210], [228, 68, 24], [222, 164, 36], [152, 84, 216]],
    }));
    const importer = vi.fn(() => palette);
    const parser = { parse: () => Promise.resolve(fakeWorld("Copper Vale")) };
    const session = createWorldSession(parser, importer);
    await session.open(file("CopperVale.wld"));
    await session.open(file("CopperValeExplored.wld"));
    expect(importer).toHaveBeenCalledTimes(2);
    expect(session.getMapPalette()).toBe(palette);
  });

  test("open_whileParsing_isLoadingWithFileName", async () => {
    const { parser, requests } = controllableParser();
    const session = createWorldSession(parser);
    const opening = session.open(file("a.wld"));
    expect(useAppStore.getState().phase).toBe("loading");
    expect(useAppStore.getState().loadingFileName).toBe("a.wld");
    requests[0]?.resolve(fakeWorld("A"));
    await opening;
  });

  test("open_parseSucceeds_storesSummaryAndKeepsWorldOutsideStore", async () => {
    const { parser, requests } = controllableParser();
    const session = createWorldSession(parser);
    const opening = session.open(file("a.wld"));
    const world = fakeWorld("Alpha", 4200, 1200);
    requests[0]?.resolve(world);
    await opening;
    const state = useAppStore.getState();
    expect(state.phase).toBe("loaded");
    expect(state.summary).toEqual({
      name: "Alpha",
      width: 4200,
      height: 1200,
      seed: "42",
      mode: "expert",
      evil: "crimson",
      formatVersion: 326,
      paletteSize: 3,
    });
    expect(session.getLoadedWorld()).toBe(world);
    expect(JSON.stringify(state)).not.toContain("planes");
  });

  test("open_parseFails_reportsCodeAndOffsetAndKeepsPreviousWorld", async () => {
    const { parser, requests } = controllableParser();
    const session = createWorldSession(parser);
    const first = session.open(file("a.wld"));
    const previous = fakeWorld("Alpha");
    requests[0]?.resolve(previous);
    await first;

    const second = session.open(file("bad.wld"));
    requests[1]?.reject(new WorldWorkerError(2, { code: "Truncated", offset: 1234, message: "short" }));
    await second;

    const state = useAppStore.getState();
    expect(state.phase).toBe("failed");
    expect(state.error).toMatchObject({ code: "Truncated", offset: 1234, fileName: "bad.wld" });
    expect(state.summary?.name).toBe("Alpha");
    expect(session.getLoadedWorld()).toBe(previous);
  });

  test("open_afterFailure_loadsNewWorldAndClearsError", async () => {
    const { parser, requests } = controllableParser();
    const session = createWorldSession(parser);
    const bad = session.open(file("bad.wld"));
    requests[0]?.reject(new WorldWorkerError(1, { code: "NotAWorld", offset: 0, message: "no" }));
    await bad;
    const good = session.open(file("b.wld"));
    requests[1]?.resolve(fakeWorld("Beta"));
    await good;
    expect(useAppStore.getState().phase).toBe("loaded");
    expect(useAppStore.getState().error).toBeNull();
    expect(useAppStore.getState().summary?.name).toBe("Beta");
  });

  test("cancel_whileLoadingFirstWorld_returnsToIdle", async () => {
    const { parser } = controllableParser();
    const session = createWorldSession(parser);
    const opening = session.open(file("a.wld"));
    session.cancel();
    await opening;
    expect(useAppStore.getState().phase).toBe("idle");
    expect(useAppStore.getState().error).toBeNull();
    expect(session.getLoadedWorld()).toBeNull();
  });

  test("cancel_whileLoadingWithPreviousWorld_returnsToLoaded", async () => {
    const { parser, requests } = controllableParser();
    const session = createWorldSession(parser);
    const first = session.open(file("a.wld"));
    const previous = fakeWorld("Alpha");
    requests[0]?.resolve(previous);
    await first;
    const second = session.open(file("b.wld"));
    session.cancel();
    await second;
    expect(useAppStore.getState().phase).toBe("loaded");
    expect(useAppStore.getState().summary?.name).toBe("Alpha");
    expect(useAppStore.getState().error).toBeNull();
    expect(session.getLoadedWorld()).toBe(previous);
  });
});
