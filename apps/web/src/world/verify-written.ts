import { readWorldTiles, type TilePlanes, type WorldTilesResult } from "@studio/world-codec";

const CONTENT_PLANES = ["block", "wall"] as const;
const VALUE_PLANES = ["frameX", "frameY", "paint", "wallPaint", "liquid", "liquidAmount", "shape", "flags"] as const satisfies readonly (keyof TilePlanes)[];
const NO_CONTENT = 0xffff;

/** The first path at which two decoded values differ: typed arrays by element, objects by key, the rest by identity. */
function difference(expected: unknown, actual: unknown, path: string): string | null {
  if (Object.is(expected, actual)) return null;
  if (ArrayBuffer.isView(expected) && ArrayBuffer.isView(actual)) {
    const left = new Uint8Array(expected.buffer, expected.byteOffset, expected.byteLength);
    const right = new Uint8Array(actual.buffer, actual.byteOffset, actual.byteLength);
    if (left.length !== right.length) return path;
    for (let index = 0; index < left.length; index++) if (left[index] !== right[index]) return path;
    return null;
  }
  if (typeof expected !== "object" || typeof actual !== "object" || expected === null || actual === null) return path;
  if (Array.isArray(expected) !== Array.isArray(actual)) return path;
  const keys = new Set([...Object.keys(expected), ...Object.keys(actual)]);
  for (const key of keys) {
    const found = difference((expected as Record<string, unknown>)[key], (actual as Record<string, unknown>)[key], `${path}.${key}`);
    if (found !== null) return found;
  }
  return null;
}

/** What a save must keep besides the tiles; section offsets are left out, since re-encoded tiles may move them. */
function keptFields(world: WorldTilesResult): unknown {
  return {
    header: world.header,
    metadata: world.metadata,
    details: world.details,
    entities: Object.fromEntries(Object.entries(world.entities).map(([name, section]) => [name, section.data])),
    opaque: world.envelope.opaqueSections.map(({ name, bytes }) => ({ name, bytes })),
  };
}

function contentKeys(world: WorldTilesResult): string[] {
  return world.palette.map((ref) => JSON.stringify(ref));
}

/**
 * Reads `output` back with the codec and compares it with the world that was written: the file header, metadata,
 * details, entity sections, opaque sections and every tile. Block and wall planes are compared by the content they name,
 * since a writer may renumber the palette.
 * Returns the first difference, or null when the written file decodes to the same world.
 */
export function verifyWrittenWorld(world: WorldTilesResult, output: ArrayBuffer): string | null {
  let written: WorldTilesResult;
  try {
    written = readWorldTiles(new Uint8Array(output));
  } catch (error) {
    return `the written file cannot be read back (${error instanceof Error ? error.message : String(error)})`;
  }
  if (written.header.version !== world.header.version) return `format ${String(written.header.version)} instead of ${String(world.header.version)}`;
  const { metadata } = world;
  if (written.metadata.width !== metadata.width || written.metadata.height !== metadata.height) return "the world size differs";
  if (written.metadata.name !== metadata.name) return "the world name differs";
  const kept = difference(keptFields(world), keptFields(written), "world");
  if (kept !== null) return `${kept} differs`;
  for (const plane of VALUE_PLANES) {
    const expected = world.planes[plane];
    const actual = written.planes[plane];
    if (actual.length !== expected.length) return `the ${plane} plane has a different length`;
    for (let index = 0; index < expected.length; index++) {
      if (actual[index] !== expected[index]) return `tile ${String(index)} differs in ${plane}`;
    }
  }
  const expectedKeys = contentKeys(world);
  const actualKeys = contentKeys(written);
  for (const plane of CONTENT_PLANES) {
    const expected = world.planes[plane];
    const actual = written.planes[plane];
    if (actual.length !== expected.length) return `the ${plane} plane has a different length`;
    for (let index = 0; index < expected.length; index++) {
      const left = expected[index] === NO_CONTENT ? null : expectedKeys[expected[index] ?? NO_CONTENT];
      const right = actual[index] === NO_CONTENT ? null : actualKeys[actual[index] ?? NO_CONTENT];
      if (left !== right) return `tile ${String(index)} differs in ${plane}`;
    }
  }
  return null;
}
