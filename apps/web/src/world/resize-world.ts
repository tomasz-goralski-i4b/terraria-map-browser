import type { TilePlanes, WorldTilesResult } from "@studio/world-codec";

/** Resize the canvas from its top-left origin; anchors outside the new canvas must be moved first. */
export function resizeWorld(world: WorldTilesResult, width: number, height: number): WorldTilesResult {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 65536 || height > 65536 ||
    width * height > Math.max(8400 * 2400, world.metadata.width * world.metadata.height)) throw new Error("Use positive dimensions up to 65,536 and an area no larger than a Large world or the current canvas.");
  const inside = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < width && y < height;
  if (width < world.metadata.width || height < world.metadata.height) {
    if (Object.values(world.entities).some((section) => section.data === null)) throw new Error("Resizing down requires readable entity sections.");
    const points = [
      ...(world.entities.Chests.data?.entries ?? []).flatMap((chest) => [{ x: chest.x, y: chest.y }, { x: chest.x + 1, y: chest.y + 1 }]),
      ...(world.entities.Signs.data?.entries ?? []).flatMap((sign) => [{ x: sign.x, y: sign.y }, { x: sign.x + 1, y: sign.y + 1 }]),
      ...(world.entities.TileEntities.data?.entries ?? []), ...(world.entities.WeightedPressurePlates.data?.entries ?? []),
      ...(world.entities.TownManager.data?.entries ?? []),
      ...(world.entities.NpcsAndMobs.data?.townNpcs ?? []).map((npc) => ({ x: npc.homeX, y: npc.homeY })),
      ...(world.entities.NpcsAndMobs.data?.townNpcs ?? []).map((npc) => ({ x: npc.x / 16, y: npc.y / 16 })),
      ...(world.entities.NpcsAndMobs.data?.mobs ?? []).map((npc) => ({ x: npc.x / 16, y: npc.y / 16 })),
    ];
    if (points.some((point) => !inside(point.x, point.y))) throw new Error("Move entities inside the new canvas before resizing down.");
  }
  // Every plane is a typed array; this is the part of their shared surface the copy needs.
  interface Plane { readonly constructor: new (length: number) => Plane; fill(value: number): unknown; set(source: ArrayLike<number>, offset: number): void; subarray(begin: number, end: number): ArrayLike<number> }
  const entries = Object.entries(world.planes as unknown as Record<string, Plane>).map(([name, plane]) => {
    const Constructor = plane.constructor;
    const resized = new Constructor(width * height);
    if (name === "block" || name === "wall") resized.fill(0xffff);
    if (name === "frameX" || name === "frameY") resized.fill(-1);
    for (let x = 0; x < Math.min(width, world.metadata.width); x++) {
      resized.set(plane.subarray(x * world.metadata.height, x * world.metadata.height + Math.min(height, world.metadata.height)), x * height);
    }
    return [name, resized];
  });
  return { ...world, planes: Object.fromEntries(entries) as TilePlanes, metadata: { ...world.metadata, width, height,
    bounds: { ...world.metadata.bounds, right: world.metadata.bounds.left + width * 16, bottom: world.metadata.bounds.top + height * 16 } } };
}
