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

/** Per tile of a region, column-major like the CWM planes (index (x − left) · height + (y − top)); −1: no cell. */
export interface BlockRegionCells {
  readonly columns: Int16Array;
  readonly rows: Int16Array;
}

export interface BlockFraming {
  /** The sheet cell of a self-framed block; null when its type is not one, or it is a falling block with nothing below. */
  readonly frameBlock: (input: BlockFramingInput) => SheetCell | null;
  /** How `centre` treats `other`; null when either is not a self-framed block type. */
  readonly kind: (centre: number, other: number) => BlockKind | null;
  /**
   * Frames every block of `region` of `world` into `out`, reading the tiles around it. Tiles frame in passes: first
   * the types without relatives, then each type once its relatives (whose cells its edge check reads) are framed.
   */
  readonly frameRegion: (world: CanonicalWorld, region: BlockRegion, out: BlockRegionCells) => void;
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
  const cellOfPacked = new Int16Array(64 * 64).fill(-1);
  packedOfCell.forEach((packed, index) => { cellOfPacked[packed] = index; });
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

  // Scratch of frameCell: the neighbours' kinds, and its two results (packed cells).
  const neighbourKinds = new Int8Array(8);
  let resultReference = -1;
  let resultCell = -1;

  /**
   * Frames one block: sets `resultReference` to its cell at variant 0 and the reference position (what a neighbour's
   * edge check reads) and `resultCell` to its cell at (x, y). Returns false when it has no cell.
   */
  function frameCell(
    type: number, shape: number, x: number, y: number,
    neighbours: ArrayLike<number>, shapes: ArrayLike<number> | undefined, rims: number,
  ): boolean {
    const index = typeIndex(type);
    if (index === -1) return false;
    if (isFalling(index) && (neighbours[6] ?? -1) < 0) return false;
    const cut = CUT_FACES[shape] ?? 0;
    let other = -1;
    let tableOther = -1;
    let tables = false;
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
        if (kind === KIND_TABLE) tables = true;
      }
    }
    if (followsBlockLayout(index) && !tables) {
      let sides = 0;
      let corners = 0;
      let code = 0;
      for (let k = 0; k < 4; k++) {
        const sideKind = neighbourKinds[SIDE_SLOTS[k] ?? 0] ?? KIND_AIR;
        const cornerKind = neighbourKinds[CORNER_SLOTS[k] ?? 0] ?? KIND_AIR;
        const sideLetter = sideKind === KIND_RELATIVE ? (((rims >> k) & 1) === 1 ? OWN : AIR) : letterOf(sideKind);
        sides = sides * 3 + sideLetter;
        corners = corners * 3 + (cornerKind === KIND_RELATIVE ? OWN : letterOf(cornerKind));
      }
      resultReference = chooseBlockCell(sides, corners);
      resultCell = resultReference;
      if (alone) {
        for (let slot = 0; slot < 8; slot++) if (neighbourKinds[slot] === KIND_SELF) code += POWERS[slot] ?? 0;
        const positioned = packedAt(database.aloneTable(type, x, y) ?? -1, code);
        if (positioned !== -1) resultCell = positioned;
      }
    } else {
      // Sheets of their own (grass, moss, gemspark, large frames) and pairs that follow no letter: the database's
      // table, with the first table-read neighbour as the other type, else the first partner or relative (it
      // tabulates pairs, not mixed neighbourhoods).
      if (tableOther !== -1) other = tableOther;
      let code = 0;
      for (let slot = 0; slot < 8; slot++) {
        const kind = neighbourKinds[slot] ?? KIND_AIR;
        const digit = kind === KIND_SELF || kind === KIND_RELATIVE ? 1 : kind === KIND_AIR ? 0 : 2;
        code += digit * (POWERS[slot] ?? 0);
      }
      if (other === -1) {
        resultReference = packedAt(database.aloneTable(type, 10, 10) ?? -1, code);
        resultCell = packedAt(database.aloneTable(type, x, y) ?? -1, code);
      } else {
        resultReference = packedAt(database.pairTable(type, other) ?? -1, code);
        // Unstable there (a falling neighbour fell): the centre still stands; read the other type as air.
        if (resultReference === -1) resultReference = packedAt(database.aloneTable(type, 10, 10) ?? -1, withoutDigit2(code));
        resultCell = resultReference;
      }
      if (resultReference === -1 || resultCell === -1) return false;
    }
    if (!database.ignoresVariant(type)) {
      const variant = (((7 * x + 11 * y) % 3) + 3) % 3;
      const cell = variant === 0 ? -1 : database.variantCell(type, cellOfPacked[resultCell] ?? -1, variant);
      if (cell !== -1) resultCell = packedOfCell[cell] ?? resultCell;
    }
    return true;
  }

  function frameBlock(input: BlockFramingInput): SheetCell | null {
    const framed = frameCell(input.type, input.shape, input.x, input.y, input.neighbours, input.neighbourShapes,
      input.rimsTowardCentre ?? 0);
    return framed ? { column: resultCell >> 6, row: resultCell & 63 } : null;
  }

  // Scratch of frameRegion, reused across calls.
  const neighbourTypes = new Int32Array(8);
  const neighbourShapes = new Uint8Array(8);
  let references = new Int16Array(0);

  function frameRegion(world: CanonicalWorld, region: BlockRegion, out: BlockRegionCells): void {
    const { width, height, planes, palette } = world;
    out.columns.fill(-1);
    out.rows.fill(-1);
    const vanilla = new Int32Array(palette.length);
    palette.forEach((ref, index) => { vanilla[index] = ref.kind === "vanilla" ? ref.id : NOT_VANILLA; });
    const typeAt = (x: number, y: number): number => {
      if (x < 0 || y < 0 || x >= width || y >= height) return -1;
      const block = planes.block[x * height + y] ?? 0xffff;
      return block === 0xffff ? -1 : vanilla[block] ?? NOT_VANILLA;
    };
    // A tile of pass p reads cells of pass p − 1 one tile away, and so on: the deepest type in the region sets how
    // far around it to frame.
    let margin = 0;
    for (let x = region.left; x < region.left + region.width; x++) {
      for (let y = region.top; y < region.top + region.height; y++) {
        const index = typeIndex(typeAt(x, y));
        if (index !== -1) margin = Math.max(margin, depthOf(index));
      }
    }
    const left = Math.max(0, region.left - margin);
    const top = Math.max(0, region.top - margin);
    const right = Math.min(width, region.left + region.width + margin);
    const bottom = Math.min(height, region.top + region.height + margin);
    const areaHeight = bottom - top;
    const area = (right - left) * areaHeight;
    if (references.length < area) references = new Int16Array(area);
    references.fill(-1, 0, area);
    for (let pass = 0; pass <= margin; pass++) {
      for (let x = left; x < right; x++) {
        for (let y = top; y < bottom; y++) {
          const type = typeAt(x, y);
          const index = typeIndex(type);
          if (index === -1 || depthOf(index) !== pass) continue;
          let rims = 0;
          for (let slot = 0; slot < 8; slot++) {
            const dx = DX[slot] ?? 0;
            const dy = DY[slot] ?? 0;
            const neighbour = typeAt(x + dx, y + dy);
            neighbourTypes[slot] = neighbour;
            neighbourShapes[slot] = neighbour < 0 ? 0 : planes.shape[(x + dx) * height + y + dy] ?? 0;
          }
          for (let side = 0; side < 4; side++) {
            const slot = SIDE_SLOTS[side] ?? 0;
            const neighbour = neighbourTypes[slot] ?? -1;
            if (neighbour < 0 || neighbour === type || kindOf(index, neighbour) !== KIND_RELATIVE) continue;
            const nx = x + DX[slot] - left;
            const ny = y + DY[slot] - top;
            // Outside the framed area the neighbour's cell is not needed for the region; assume its rim is kept.
            const cell = nx < 0 || ny < 0 || nx >= right - left || ny >= areaHeight ? -2 : references[nx * areaHeight + ny] ?? -1;
            if (cell === -2 || cellSide(cell, (side + 2) % 4) === PARTNER) rims |= 1 << side;
          }
          if (!frameCell(type, planes.shape[x * height + y] ?? 0, x, y, neighbourTypes, neighbourShapes, rims)) continue;
          references[(x - left) * areaHeight + (y - top)] = resultReference;
          const rx = x - region.left;
          const ry = y - region.top;
          if (rx >= 0 && ry >= 0 && rx < region.width && ry < region.height) {
            out.columns[rx * region.height + ry] = resultCell >> 6;
            out.rows[rx * region.height + ry] = resultCell & 63;
          }
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
