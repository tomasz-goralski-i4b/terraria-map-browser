import { describe, expect, it } from "vitest";
import { collectTransferList, type TilePlanes, type WorldTilesResult } from "./index.js";

function resultWith(planes: TilePlanes): WorldTilesResult {
  return { planes, palette: [], envelope: { source: new Uint8Array(167) } } as unknown as WorldTilesResult;
}

function planes(shared?: ArrayBuffer): TilePlanes {
  const base: TilePlanes = {
    block: new Uint16Array(4),
    wall: new Uint16Array(4),
    frameX: new Int16Array(4),
    frameY: new Int16Array(4),
    paint: new Uint8Array(4),
    wallPaint: new Uint8Array(4),
    liquid: new Uint8Array(4),
    liquidAmount: new Uint8Array(4),
    shape: new Uint8Array(4),
    flags: new Uint16Array(4),
  };
  return shared === undefined ? base : { ...base, paint: new Uint8Array(shared), wallPaint: new Uint8Array(shared) };
}

describe("collectTransferList", () => {
  it("collectTransferList_TenDistinctPlanes_ListsEachBufferOnce", () => {
    const list = collectTransferList(resultWith(planes()));
    expect(list).toHaveLength(11);
    expect(new Set(list).size).toBe(11);
  });

  it("collectTransferList_PlanesShareOneBuffer_ListsItOnce", () => {
    const shared = new ArrayBuffer(4);
    const list = collectTransferList(resultWith(planes(shared)));
    expect(list.filter((buffer) => buffer === shared)).toHaveLength(1);
    expect(list).toHaveLength(10);
  });
});
