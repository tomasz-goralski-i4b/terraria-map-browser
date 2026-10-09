import type { CanonicalWorld } from "@studio/world-model";
import { AIR, OWN, PARTNER, cellSide, chooseBlockCell } from "./block-rules.js";
import type { FramingDatabase } from "./framing-database.js";

/** A cell of a tile sheet: column and row of 18-pixel cells. */
export interface SheetCell {
  readonly column: number;
  readonly row: number;
}

/** One self-framed block and its neighbourhood (docs/assets.md, "Tile framing"). */
export interface BlockFramingInput {
  /** The vanilla tile id of the centre. */
  readonly type: number;
  /** The centre's shape: 0 full, 1 half, 2–5 slopes (the `.wld` / CWM shape code). */
  readonly shape: number;
  /** The tile's world position: it picks the variant and the cell of position-framed types. */
  readonly x: number;
  readonly y: number;
  /**
   * The eight neighbours' tile ids in NEIGHBOUR_ORDER (NW N NE W E SW S SE); −1 where there is no block. Any id that
   * is not a self-framed block type (furniture, or NOT_VANILLA for modded and unknown content) is a block that does not
   * merge: it counts as absent for the cell, but it holds up a falling block above it.
   */
  readonly neighbours: ArrayLike<number>;
  /** The neighbours' shapes in NEIGHBOUR_ORDER; all full when omitted. */
  readonly neighbourShapes?: ArrayLike<number>;
  /**
   * The edge check: bit 1 N, 2 E, 4 S, 8 W set where that edge neighbour is a relative of the centre and its own cell
   * keeps its rim toward the centre. Ignored for other neighbours; 0 when omitted.
   */
  readonly rimsTowardCentre?: number;
}

/**
 * How a block type treats another self-framed type (docs/assets.md, "Neighbour classes"): like air, like itself, as
 * its partner, as a relative (edge check), or by a table that follows no letter (looked up directly).
 */
export type BlockKind = "air" | "self" | "partner" | "relative" | "table";

export interface BlockRegion {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** A region cell with no sheet cell (no block, not self-framed, or a falling block with nothing below). */
export const NO_CELL = 0xffff;

export interface BlockFraming {
  /** The sheet cell of a self-framed block; null when its type is not one, or it is a falling block with nothing below. */
  readonly frameBlock: (input: BlockFramingInput) => SheetCell | null;
  /** How `centre` treats `other`; null when either is not a self-framed block type. */
  readonly kind: (centre: number, other: number) => BlockKind | null;
  /**
   * The pass a type frames in: 0 without relatives, else one more than its deepest relative (at most 5); −1 when it
   * is not a self-framed block type. An edit at a tile changes cells up to d + 1 tiles around it, d the deepest depth
   * of the types there (not only the edited type's), so 6 tiles is always enough.
   */
  readonly depth: (type: number) => number;
  /**
   * Frames every block of `region` of `world` into `out`: per tile, column-major like the CWM planes (index
   * (x − left) · height + (y − top)), the packed cell column · 64 + row, or NO_CELL. It reads the tiles around the
   * region. Tiles frame in passes: first
   * the types without relatives, then each type once its relatives (whose cells its edge check reads) are framed.
   */
  readonly frameRegion: (world: CanonicalWorld, region: BlockRegion, out: Uint16Array) => void;
}

const KIND_AIR = 0;
const KIND_SELF = 1;
const KIND_PARTNER = 2;
const KIND_RELATIVE = 3;
const KIND_TABLE = 4;
const KIND_NAMES: readonly BlockKind[] = ["air", "self", "partner", "relative", "table"];

/** The neighbour id frameRegion passes for a block that is not vanilla content (modded or unknown). */
export const NOT_VANILLA = 0x10000;

/** Neighbour slots (NEIGHBOUR_ORDER) of the sides N E S W and the corners NW NE SE SW. */
const SIDE_SLOTS = [1, 4, 6, 3] as const;
const CORNER_SLOTS = [0, 2, 7, 5] as const;
/** Slot → side (0 N, 1 E, 2 S, 3 W), −1 for a corner. */
const SIDE_OF_SLOT = [-1, 0, -1, 3, 1, -1, 2, -1] as const;
/** Neighbour offsets in NEIGHBOUR_ORDER, as separate x and y arrays (destructuring would allocate per tile). */
const DX = [-1, 0, 1, -1, 1, -1, 0, 1] as const;
const DY = [-1, -1, -1, 0, 0, 1, 1, 1] as const;
/** Faces cut by each shape, one bit per side (1 N, 2 E, 4 S, 8 W): half N; slopes 2 N+E, 3 N+W, 4 S+E, 5 S+W. */
const CUT_FACES = [0, 1, 3, 9, 6, 12] as const;
const POWERS = [1, 3, 9, 27, 81, 243, 729, 2187] as const;
const CODES = 6561;

const pack = (column: number, row: number): number => column * 64 + row;
const digitAt = (code: number, slot: number): number => Math.floor(code / (POWERS[slot] ?? 1)) % 3;

/** The block layout's cell for neighbourhood `code`, reading digit 0 as air, 1 as itself and 2 as `two`. */
function ruleCell(code: number, two: number): number {
  const letter = (slot: number): number => {
    const digit = digitAt(code, slot);
    return digit === 0 ? AIR : digit === 1 ? OWN : two;
  };
  const sides = letter(1) * 27 + letter(4) * 9 + letter(6) * 3 + letter(3);
  const corners = letter(0) * 27 + letter(2) * 9 + letter(7) * 3 + letter(5);
  return chooseBlockCell(sides, corners);
}

export function createBlockFraming(database: FramingDatabase): BlockFraming {
  const types = database.blockTypes;
  const count = types.length;
  const indexOfType = new Int16Array(Math.max(...types) + 1).fill(-1);
  types.forEach((type, index) => { indexOfType[type] = index; });
  const typeIndex = (type: number): number => (type >= 0 && type < indexOfType.length ? indexOfType[type] ?? -1 : -1);

  const packedOfCell = database.cells.map(([column, row]) => pack(column, row));
  const packedAt = (table: number, code: number): number => {
    const cell = database.tableCell(table, code);
    return cell === -1 ? -1 : packedOfCell[cell] ?? -1;
  };

  // Everything below is derived from the database on first use and kept: -1 means not derived yet.
  const tableKinds = new Int8Array(database.tableCount).fill(-1);
  const cornerTables = new Int8Array(database.tableCount).fill(-1);
  const blockLayouts = new Int8Array(count).fill(-1);
  const kinds = new Int8Array(count * count).fill(-1);
  const depths = new Int8Array(count).fill(-1);

  /** Does `table` equal the block layout's rule wherever the game kept the neighbourhood (and `include` holds)? */
  function followsRule(table: number, two: number, include: (code: number) => boolean): boolean {
    for (let code = 0; code < CODES; code++) {
      if (!include(code)) continue;
      const cell = packedAt(table, code);
      if (cell !== -1 && cell !== ruleCell(code, two)) return false;
    }
    return true;
  }

  /**
   * The letter a table gives the other type: like itself, like air or partner when the table is the block rule with
   * that letter (the extra tables of falling types differ from it only where a tile fell); otherwise a table.
   */
  function tableKind(table: number): number {
    let kind = tableKinds[table] ?? -1;
    if (kind !== -1) return kind;
    kind = KIND_TABLE;
    for (const [letter, candidate] of [[OWN, KIND_SELF], [AIR, KIND_AIR], [PARTNER, KIND_PARTNER]] as const) {
      if (followsRule(table, letter, () => true)) {
        kind = candidate;
        break;
      }
    }
    tableKinds[table] = kind;
    return kind;
  }

  /** A relative's table connects at corners: it is the rule with the other type as itself where no edge holds it. */
  function cornersConnect(table: number): boolean {
    let connect = cornerTables[table] ?? -1;
    if (connect === -1) {
      const edgesFree = (code: number): boolean => SIDE_SLOTS.every((slot) => digitAt(code, slot) !== 2);
      connect = followsRule(table, OWN, edgesFree) ? 1 : 0;
      cornerTables[table] = connect;
    }
    return connect === 1;
  }

  /** Does the type frame alone by the block layout's rule (dirt, stone, …) rather than a sheet of its own? */
  function followsBlockLayout(index: number): boolean {
    let layout = blockLayouts[index] ?? -1;
    if (layout === -1) {
      const type = types[index] ?? -1;
      const table = database.aloneTable(type, 10, 10) ?? -1;
      const alone = (code: number): boolean => SIDE_SLOTS.every((slot) => digitAt(code, slot) !== 2)
        && CORNER_SLOTS.every((slot) => digitAt(code, slot) !== 2);
      layout = followsRule(table, OWN, alone) ? 1 : 0;
      blockLayouts[index] = layout;
    }
    return layout === 1;
  }

  /** Kind of `centre` (type index) toward tile id `other`; other blocks (not self-framed) count as air. */
  function kindOf(centre: number, other: number): number {
    const index = typeIndex(other);
    if (index === -1) return KIND_AIR;
    let kind = kinds[centre * count + index] ?? -1;
    if (kind !== -1) return kind;
    const type = types[centre] ?? -1;
    const relation = database.relation(type, other);
    if (relation === "self") kind = KIND_SELF;
    else if (relation !== "table") kind = KIND_AIR;
    else {
      const table = database.pairTable(type, other) ?? -1;
      kind = tableKind(table);
      if (kind === KIND_TABLE) {
        // A relative: the other type sees this one as its partner, and this one connects to it at corners.
        const back = database.pairTable(other, type);
        if (back !== null && tableKind(back) === KIND_PARTNER && cornersConnect(table)) kind = KIND_RELATIVE;
      }
    }
    kinds[centre * count + index] = kind;
    return kind;
  }

  /** 0 for a type without relatives, else one more than its deepest relative: the pass that frames it. */
  function depthOf(index: number): number {
    let depth = depths[index] ?? -1;
    if (depth !== -1) return depth;
    depths[index] = 0;
    depth = 0;
    for (let other = 0; other < count; other++) {
      if (other !== index && kindOf(index, types[other] ?? -1) === KIND_RELATIVE) depth = Math.max(depth, depthOf(other) + 1);
    }
    depths[index] = depth;
    return depth;
  }

  const falling = new Int8Array(count).fill(-1);
  /** A falling block (sand and the like): alone, with nothing around it, the game keeps no cell. */
  function isFalling(index: number): boolean {
    let value = falling[index] ?? -1;
    if (value === -1) {
      value = database.tableCell(database.aloneTable(types[index] ?? -1, 10, 10) ?? -1, 0) === -1 ? 1 : 0;
      falling[index] = value;
    }
    return value === 1;
  }

  // Per type, derived on first use: its table alone at the reference position, whether it frames by position, whether
  // it ignores the variant (−1: not derived yet).
  const aloneReference = new Int32Array(count).fill(-1);
  const positional = new Int8Array(count).fill(-1);
  const variantless = new Int8Array(count).fill(-1);
  /** Per type: packed cell → its variant-1 and variant-2 packed cells (−1 not observed), built on first use. */
  const variantCells: (Int16Array | undefined)[] = [];
  function deriveType(index: number): void {
    const type = types[index] ?? -1;
    const reference = database.aloneTable(type, 10, 10) ?? -1;
    aloneReference[index] = reference;
    let byPosition = false;
    for (let a = 0; a < 6; a++) {
      for (let b = 0; b < 4; b++) if (database.aloneTable(type, a, b) !== reference) byPosition = true;
    }
    positional[index] = byPosition ? 1 : 0;
    variantless[index] = database.ignoresVariant(type) ? 1 : 0;
    const variants = new Int16Array(64 * 64 * 2).fill(-1);
    database.cells.forEach((_, cell) => {
      const packed = packedOfCell[cell] ?? 0;
      for (const variant of [1, 2]) {
        const varied = database.variantCell(type, cell, variant);
        if (varied !== -1) variants[packed * 2 + variant - 1] = packedOfCell[varied] ?? -1;
      }
    });
    variantCells[index] = variants;
  }

  // Scratch of frameCell: the neighbours' kinds.
  const neighbourKinds = new Int8Array(8);

  /**
   * Frames one block. Returns −1 when it has no cell, else `reference << 12 | cell`: its cell at variant 0 and the
   * reference position (what a neighbour's edge check reads) and its cell at (x, y), both packed column · 64 + row.
   */
  function frameCell(
    type: number, shape: number, x: number, y: number,
    neighbours: ArrayLike<number>, shapes: ArrayLike<number> | undefined, rims: number,
  ): number {
    const index = typeIndex(type);
    if (index === -1) return -1;
    if (isFalling(index) && (neighbours[6] ?? -1) < 0) return -1;
    if (aloneReference[index] === -1) deriveType(index);
    const cut = CUT_FACES[shape] ?? 0;
    let other = -1;
    let tableOther = -1;
    let alone = true;
    for (let slot = 0; slot < 8; slot++) {
      let neighbour = neighbours[slot] ?? -1;
      const side = SIDE_OF_SLOT[slot] ?? -1;
      if (neighbour >= 0 && side !== -1) {
        // The face rule: a side connects only where the centre's face and the neighbour's facing face are whole.
        const facing = (side + 2) % 4;
        if (((cut >> side) & 1) === 1 || (((CUT_FACES[shapes?.[slot] ?? 0] ?? 0) >> facing) & 1) === 1) neighbour = -1;
      }
      const kind = neighbour < 0 ? KIND_AIR : neighbour === type ? KIND_SELF : kindOf(index, neighbour);
      neighbourKinds[slot] = kind;
      if (kind >= KIND_PARTNER) {
        alone = false;
        if (other === -1) other = neighbour;
        if (kind === KIND_TABLE && tableOther === -1) tableOther = neighbour;
      }
    }
    let reference: number;
    let cell: number;
    if (followsBlockLayout(index) && tableOther === -1) {
      let sides = 0;
      let corners = 0;
      for (let k = 0; k < 4; k++) {
        const sideKind = neighbourKinds[SIDE_SLOTS[k] ?? 0] ?? KIND_AIR;
        const cornerKind = neighbourKinds[CORNER_SLOTS[k] ?? 0] ?? KIND_AIR;
        const sideLetter = sideKind === KIND_RELATIVE ? (((rims >> k) & 1) === 1 ? OWN : AIR) : letterOf(sideKind);
        sides = sides * 3 + sideLetter;
        corners = corners * 3 + (cornerKind === KIND_RELATIVE ? OWN : letterOf(cornerKind));
      }
      reference = chooseBlockCell(sides, corners);
      cell = reference;
      if (alone && positional[index] === 1) {
        let code = 0;
        for (let slot = 0; slot < 8; slot++) if (neighbourKinds[slot] === KIND_SELF) code += POWERS[slot] ?? 0;
        const positioned = packedAt(database.aloneTable(type, x, y) ?? -1, code);
        if (positioned !== -1) cell = positioned;
      }
    } else {
      // Sheets of their own (grass, moss, gemspark, large frames) and pairs that follow no letter: the database's
      // table, with the first table-read neighbour as the other type, else the first partner or relative (it
      // tabulates pairs, not mixed neighbourhoods). A relative's edge still connects only where it keeps its rim.
      if (tableOther !== -1) other = tableOther;
      let code = 0;
      for (let slot = 0; slot < 8; slot++) {
        const kind = neighbourKinds[slot] ?? KIND_AIR;
        const side = SIDE_OF_SLOT[slot] ?? -1;
        let digit = kind === KIND_SELF ? 1 : kind === KIND_AIR ? 0 : 2;
        if (kind === KIND_RELATIVE && neighbours[slot] !== other) digit = side === -1 || ((rims >> side) & 1) === 1 ? 1 : 0;
        code += digit * (POWERS[slot] ?? 0);
      }
      if (other === -1) {
        reference = packedAt(aloneReference[index] ?? -1, code);
        cell = positional[index] === 1 ? packedAt(database.aloneTable(type, x, y) ?? -1, code) : reference;
      } else {
        reference = packedAt(database.pairTable(type, other) ?? -1, code);
        // Unstable there (a falling neighbour fell): the centre still stands; read the other type as air.
        if (reference === -1) reference = packedAt(aloneReference[index] ?? -1, withoutDigit2(code));
        cell = reference;
      }
      if (reference === -1 || cell === -1) return -1;
    }
    if (variantless[index] === 0) {
      const variant = (((7 * x + 11 * y) % 3) + 3) % 3;
      const varied = variant === 0 ? -1 : variantCells[index]?.[cell * 2 + variant - 1] ?? -1;
      if (varied !== -1) cell = varied;
    }
    return (reference << 12) | cell;
  }

  function frameBlock(input: BlockFramingInput): SheetCell | null {
    const framed = frameCell(input.type, input.shape, input.x, input.y, input.neighbours, input.neighbourShapes,
      input.rimsTowardCentre ?? 0);
    return framed === -1 ? null : { column: (framed >> 6) & 63, row: framed & 63 };
  }

  // Scratch of frameRegion, reused across calls and grown when a larger area comes: the area's tile ids with a ring of
  // one tile around it (−1 none), their shapes, their passes (−1 not framed here) and their reference cells.
  const neighbourTypes = new Int32Array(8);
  const neighbourShapes = new Uint8Array(8);
  const offsets = new Int32Array(8);
  let areaTypes = new Int32Array(0);
  let areaShapes = new Uint8Array(0);
  let areaPasses = new Int8Array(0);
  let references = new Int16Array(0);

  function frameRegion(world: CanonicalWorld, region: BlockRegion, out: Uint16Array): void {
    out.fill(NO_CELL);
    const { width, height, planes, palette } = world;
    const vanilla = new Int32Array(palette.length);
    palette.forEach((ref, index) => { vanilla[index] = ref.kind === "vanilla" ? ref.id : NOT_VANILLA; });
    // A tile of pass p reads cells of pass p − 1 one tile away, and so on: the deepest type in the region sets how
    // far around it to frame.
    let margin = 0;
    for (let x = Math.max(0, region.left); x < Math.min(width, region.left + region.width); x++) {
      for (let y = Math.max(0, region.top); y < Math.min(height, region.top + region.height); y++) {
        const block = planes.block[x * height + y] ?? 0xffff;
        const index = block === 0xffff ? -1 : typeIndex(vanilla[block] ?? -1);
        if (index !== -1) margin = Math.max(margin, depthOf(index));
      }
    }
    const left = Math.max(0, region.left - margin);
    const top = Math.max(0, region.top - margin);
    const right = Math.min(width, region.left + region.width + margin);
    const bottom = Math.min(height, region.top + region.height + margin);
    if (right <= left || bottom <= top) return;
    // The padded area: column i, row j holds tile (left − 1 + i, top − 1 + j); the outer ring is read, never framed.
    const columns = right - left + 2;
    const stride = bottom - top + 2;
    if (areaTypes.length < columns * stride) {
      areaTypes = new Int32Array(columns * stride);
      areaShapes = new Uint8Array(columns * stride);
      areaPasses = new Int8Array(columns * stride);
      references = new Int16Array(columns * stride);
    }
    let shaped = false;
    for (let i = 0; i < columns; i++) {
      const x = left - 1 + i;
      for (let j = 0; j < stride; j++) {
        const y = top - 1 + j;
        const at = i * stride + j;
        const block = x < 0 || y < 0 || x >= width || y >= height ? 0xffff : planes.block[x * height + y] ?? 0xffff;
        const type = block === 0xffff ? -1 : vanilla[block] ?? NOT_VANILLA;
        const shape = type === -1 ? 0 : planes.shape[x * height + y] ?? 0;
        const index = typeIndex(type);
        const ring = i === 0 || j === 0 || i === columns - 1 || j === stride - 1;
        areaTypes[at] = type;
        areaShapes[at] = shape;
        if (shape !== 0) shaped = true;
        areaPasses[at] = index === -1 || ring ? -1 : depthOf(index);
        references[at] = -1;
      }
    }
    const shapes = shaped ? neighbourShapes : undefined;
    for (let slot = 0; slot < 8; slot++) offsets[slot] = (DX[slot] ?? 0) * stride + (DY[slot] ?? 0);
    for (let pass = 0; pass <= margin; pass++) {
      for (let i = 1; i < columns - 1; i++) {
        for (let j = 1; j < stride - 1; j++) {
          const at = i * stride + j;
          if (areaPasses[at] !== pass) continue;
          const type = areaTypes[at] ?? -1;
          const index = typeIndex(type);
          for (let slot = 0; slot < 8; slot++) {
            const near = at + (offsets[slot] ?? 0);
            neighbourTypes[slot] = areaTypes[near] ?? -1;
            if (shaped) neighbourShapes[slot] = areaShapes[near] ?? 0;
          }
          let rims = 0;
          for (let side = 0; side < 4; side++) {
            const slot = SIDE_SLOTS[side] ?? 0;
            const neighbour = neighbourTypes[slot] ?? -1;
            if (neighbour < 0 || neighbour === type || kindOf(index, neighbour) !== KIND_RELATIVE) continue;
            const ni = i + DX[slot];
            const nj = j + DY[slot];
            // In the ring the neighbour's cell is not needed for the region; assume its rim is kept.
            const ring = ni === 0 || nj === 0 || ni === columns - 1 || nj === stride - 1;
            if (ring || cellSide(references[ni * stride + nj] ?? -1, (side + 2) % 4) === PARTNER) rims |= 1 << side;
          }
          const x = left - 1 + i;
          const y = top - 1 + j;
          const framed = frameCell(type, areaShapes[at] ?? 0, x, y, neighbourTypes, shapes, rims);
          if (framed === -1) continue;
          references[at] = framed >> 12;
          const rx = x - region.left;
          const ry = y - region.top;
          if (rx >= 0 && ry >= 0 && rx < region.width && ry < region.height) out[rx * region.height + ry] = framed & 4095;
        }
      }
    }
  }

  return {
    frameBlock,
    kind: (centre, other) => {
      const index = typeIndex(centre);
      if (index === -1 || typeIndex(other) === -1) return null;
      return other === centre ? "self" : KIND_NAMES[kindOf(index, other)] ?? null;
    },
    depth: (type) => {
      const index = typeIndex(type);
      return index === -1 ? -1 : depthOf(index);
    },
    frameRegion,
  };
}

/** The letter of a neighbour kind other than a relative: like itself OWN, partner PARTNER, else AIR. */
function letterOf(kind: number): number {
  return kind === KIND_SELF ? OWN : kind === KIND_PARTNER ? PARTNER : AIR;
}

/** `code` with every digit 2 replaced by 0. */
function withoutDigit2(code: number): number {
  let result = 0;
  for (let slot = 0; slot < 8; slot++) {
    const digit = digitAt(code, slot);
    if (digit === 1) result += POWERS[slot] ?? 0;
  }
  return result;
}
