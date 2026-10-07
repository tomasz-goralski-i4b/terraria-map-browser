// Measures the look of every cell of a block sheet (docs/assets.md, "Tile framing" → "Measuring the sheet").
// Pure: works on decoded RGBA only, so the tests run on synthetic sheets and nothing from the game is needed in CI.

/** Decoded sheet pixels, row-major RGBA. */
export interface SheetPixels {
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8Array;
}

/** `o` open (body to the edge), `x` closed (outline, cut away or notch), `d` rim (partner texture). */
export type EdgeLetter = "o" | "x" | "d";

/** One measured cell: side code `NESW` and corner code `NW NE SE SW`. */
export interface CellLook {
  readonly column: number;
  readonly row: number;
  readonly sides: string;
  readonly corners: string;
}

export interface MeasureOptions {
  /** Colours of the merge partner's art, `"r,g,b"`. Empty when the sheet has no partner. */
  readonly partnerColours?: ReadonlySet<string>;
  /** Extra colours that mark a notch corner (dirt draws notches with highlight pixels instead of outline). */
  readonly notchColours?: ReadonlySet<string>;
  /** Rows to measure; the block layout of this section uses the first 15. */
  readonly rows?: number;
  readonly columns?: number;
}

export interface SheetMeasurement {
  readonly outlineColours: readonly string[];
  readonly partnerColours: readonly string[];
  /** Non-empty cells in reading order (row first, then column). */
  readonly cells: readonly CellLook[];
}

const CELL = 16;
const STRIDE = 18;
const RING = 2;

type PixelClass = "transparent" | "outline" | "partner" | "notch" | "body";

function colourAt(sheet: SheetPixels, x: number, y: number): string | undefined {
  const i = (y * sheet.width + x) * 4;
  if (sheet.rgba[i + 3] === 0) return undefined;
  return `${String(sheet.rgba[i])},${String(sheet.rgba[i + 1])},${String(sheet.rgba[i + 2])}`;
}

function cellIsEmpty(sheet: SheetPixels, column: number, row: number): boolean {
  for (let y = 0; y < CELL; y++)
    for (let x = 0; x < CELL; x++) if (colourAt(sheet, column * STRIDE + x, row * STRIDE + y) !== undefined) return false;
  return true;
}

function cellFits(sheet: SheetPixels, column: number, row: number): boolean {
  return column * STRIDE + CELL <= sheet.width && row * STRIDE + CELL <= sheet.height;
}

/** Colours of all opaque pixels of a sheet (used as the partner colours of the sheets that merge with it). */
export function sheetColours(sheet: SheetPixels): Set<string> {
  const colours = new Set<string>();
  for (let y = 0; y < sheet.height; y++)
    for (let x = 0; x < sheet.width; x++) {
      const colour = colourAt(sheet, x, y);
      if (colour !== undefined) colours.add(colour);
    }
  return colours;
}

/**
 * Outline colours: they occur in the 2-pixel ring of some non-empty cell but never in the 8 × 8 middle of any
 * non-empty cell, and are not partner colours.
 */
function outlineColours(sheet: SheetPixels, rows: number, columns: number, partner: ReadonlySet<string>): Set<string> {
  const ring = new Set<string>();
  const middle = new Set<string>();
  for (let row = 0; row < rows; row++)
    for (let column = 0; column < columns; column++) {
      if (!cellFits(sheet, column, row) || cellIsEmpty(sheet, column, row)) continue;
      for (let y = 0; y < CELL; y++)
        for (let x = 0; x < CELL; x++) {
          const colour = colourAt(sheet, column * STRIDE + x, row * STRIDE + y);
          if (colour === undefined) continue;
          if (x < RING || y < RING || x >= CELL - RING || y >= CELL - RING) ring.add(colour);
          if (x >= 4 && x < 12 && y >= 4 && y < 12) middle.add(colour);
        }
    }
  return new Set([...ring].filter((colour) => !middle.has(colour) && !partner.has(colour)));
}

function classify(colour: string | undefined, outline: ReadonlySet<string>, options: MeasureOptions): PixelClass {
  if (colour === undefined) return "transparent";
  if (outline.has(colour)) return "outline";
  if (options.partnerColours?.has(colour) === true) return "partner";
  if (options.notchColours?.has(colour) === true) return "notch";
  return "body";
}

function count(classes: readonly PixelClass[], wanted: PixelClass): number {
  return classes.filter((c) => c === wanted).length;
}

/** Side: the middle 12 pixels of the outermost row or column. */
function sideLetter(classes: readonly PixelClass[]): EdgeLetter {
  const partner = count(classes, "partner");
  const body = count(classes, "body") + count(classes, "notch");
  const closed = count(classes, "outline") + count(classes, "transparent");
  if (partner > 0 && partner >= body && partner >= closed) return "d";
  if (body > partner + closed) return "o";
  return "x";
}

/** Corner: the 2 × 2 corner pixels. */
function cornerLetter(classes: readonly PixelClass[]): EdgeLetter {
  if (count(classes, "partner") >= 3) return "d";
  if (count(classes, "outline") + count(classes, "transparent") + count(classes, "notch") >= 3) return "x";
  return "o";
}

export function measureSheet(sheet: SheetPixels, options: MeasureOptions = {}): SheetMeasurement {
  const rows = options.rows ?? 15;
  const columns = options.columns ?? 16;
  const partner = options.partnerColours ?? new Set<string>();
  const outline = outlineColours(sheet, rows, columns, partner);
  const cells: CellLook[] = [];
  for (let row = 0; row < rows; row++)
    for (let column = 0; column < columns; column++) {
      if (!cellFits(sheet, column, row) || cellIsEmpty(sheet, column, row)) continue;
      const at = (x: number, y: number): PixelClass =>
        classify(colourAt(sheet, column * STRIDE + x, row * STRIDE + y), outline, options);
      const span = Array.from({ length: CELL - 2 * RING }, (_, i) => i + RING);
      const sides = [
        span.map((x) => at(x, 0)),
        span.map((y) => at(CELL - 1, y)),
        span.map((x) => at(x, CELL - 1)),
        span.map((y) => at(0, y)),
      ].map(sideLetter);
      const corner = (x0: number, y0: number): EdgeLetter =>
        cornerLetter([at(x0, y0), at(x0 + 1, y0), at(x0, y0 + 1), at(x0 + 1, y0 + 1)]);
      const corners = [corner(0, 0), corner(CELL - 2, 0), corner(CELL - 2, CELL - 2), corner(0, CELL - 2)];
      cells.push({ column, row, sides: sides.join(""), corners: corners.join("") });
    }
  return { outlineColours: [...outline].sort(), partnerColours: [...partner].sort(), cells };
}

/** A look: the side code, plus the corner code when all four sides are open (`oooo`). */
export function lookOf(cell: CellLook): string {
  return cell.sides === "oooo" ? `oooo/${cell.corners}` : cell.sides;
}

/** Groups cells by look, keeping reading order inside each group (the variant order v0, v1, v2). */
export function groupLooks(cells: readonly CellLook[]): Map<string, CellLook[]> {
  const looks = new Map<string, CellLook[]>();
  for (const cell of cells) {
    const key = lookOf(cell);
    const group = looks.get(key);
    if (group === undefined) looks.set(key, [cell]);
    else group.push(cell);
  }
  return looks;
}

/** Side codes over `o`/`d`/`x` that contain `d` and have no cell in the measurement. */
export function missingRimCodes(cells: readonly CellLook[]): string[] {
  const present = new Set(cells.map((cell) => cell.sides));
  const letters = ["o", "d", "x"] as const;
  const missing: string[] = [];
  for (const n of letters)
    for (const e of letters)
      for (const s of letters)
        for (const w of letters) {
          const code = `${n}${e}${s}${w}`;
          if (code.includes("d") && !present.has(code)) missing.push(code);
        }
  return missing.sort();
}

/** Text sheet map: the side code of every cell, `----` for an empty cell (the format used in docs/assets.md). */
export function formatSheetMap(cells: readonly CellLook[], rows = 15, columns = 16): string {
  const byPosition = new Map(cells.map((cell) => [`${String(cell.column)},${String(cell.row)}`, cell.sides]));
  const header = `    ${Array.from({ length: columns }, (_, c) => String(c).padStart(4)).join(" ")}`;
  const lines = [header];
  for (let row = 0; row < rows; row++) {
    const codes = Array.from({ length: columns }, (_, c) => byPosition.get(`${String(c)},${String(row)}`) ?? "----");
    lines.push(`${String(row).padStart(3)}  ${codes.join(" ")}`);
  }
  return lines.join("\n");
}

/** Cells whose look differs between two measurements of the same layout (missing cells count as differences). */
export function compareLooks(reference: readonly CellLook[], other: readonly CellLook[]): string[] {
  const key = (cell: CellLook): string => `${String(cell.column)},${String(cell.row)}`;
  const theirs = new Map(other.map((cell) => [key(cell), lookOf(cell)]));
  const ours = new Map(reference.map((cell) => [key(cell), lookOf(cell)]));
  const positions = new Set([...ours.keys(), ...theirs.keys()]);
  return [...positions]
    .filter((position) => ours.get(position) !== theirs.get(position))
    .map((position) => `(${position}) ${ours.get(position) ?? "empty"} vs ${theirs.get(position) ?? "empty"}`);
}
