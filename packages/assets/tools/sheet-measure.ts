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
 * Colours of `sheet` within `tolerance` (largest channel difference) of some `reference` colour. Grass sheets draw
 * their dirt with lighting variants of the dirt sheet's colours (`150,107,76` next to dirt's `151,107,75`), so an
 * exact match misses them.
 */
export function nearColours(sheet: SheetPixels, reference: ReadonlySet<string>, tolerance: number): Set<string> {
  const parse = (colour: string): number[] => colour.split(",").map(Number);
  const wanted = [...reference].map(parse);
  return new Set(
    [...sheetColours(sheet)].filter((colour) => {
      const rgb = parse(colour);
      return wanted.some((other) => rgb.every((channel, i) => Math.abs(channel - (other[i] ?? 0)) <= tolerance));
    }),
  );
}

/** The rim-free block of the stone layout: columns 0–12 of rows 0–4 (docs/assets.md, sheet map). */
export const SELF_REGION = { columns: 13, rows: 5 } as const;

/**
 * Colours used outside `region` but never inside it. Applied with `SELF_REGION`, these are the colours a sheet uses
 * only for its rim art, whatever its partner looks like (mud draws its dirt rims in its own grey shades, and an ash
 * sheet shares body colours with hellstone). Measuring with them as partner colours tests the layout: if the sheet
 * does not share the stone layout, the rim letters do not land on the rim slots.
 */
export function coloursOutside(sheet: SheetPixels, region: { readonly columns: number; readonly rows: number }): Set<string> {
  const inside = new Set<string>();
  const outside = new Set<string>();
  for (let y = 0; y < sheet.height; y++)
    for (let x = 0; x < sheet.width; x++) {
      const colour = colourAt(sheet, x, y);
      if (colour === undefined) continue;
      const within = Math.floor(x / STRIDE) < region.columns && Math.floor(y / STRIDE) < region.rows;
      (within ? inside : outside).add(colour);
    }
  return new Set([...outside].filter((colour) => !inside.has(colour)));
}

/** Outline colours occur at least this many times as often in the ring as in the middle (per pixel count). */
const OUTLINE_RATIO = 4;

/**
 * Outline colours: in the non-empty cells, they occur at least `OUTLINE_RATIO` times as often in the 2-pixel ring
 * as in the 8 × 8 middle (a colour never seen in the middle qualifies at once), and are not partner colours. A strict
 * "never in the middle" test fails for sheets whose dark outline colour also shades the body (ids 9, 41, 43, …).
 */
function outlineColours(sheet: SheetPixels, rows: number, columns: number, partner: ReadonlySet<string>): Set<string> {
  const ring = new Map<string, number>();
  const middle = new Map<string, number>();
  const add = (counts: Map<string, number>, colour: string): void => {
    counts.set(colour, (counts.get(colour) ?? 0) + 1);
  };
  for (let row = 0; row < rows; row++)
    for (let column = 0; column < columns; column++) {
      if (!cellFits(sheet, column, row) || cellIsEmpty(sheet, column, row)) continue;
      for (let y = 0; y < CELL; y++)
        for (let x = 0; x < CELL; x++) {
          const colour = colourAt(sheet, column * STRIDE + x, row * STRIDE + y);
          if (colour === undefined) continue;
          if (x < RING || y < RING || x >= CELL - RING || y >= CELL - RING) add(ring, colour);
          if (x >= 4 && x < 12 && y >= 4 && y < 12) add(middle, colour);
        }
    }
  return new Set(
    [...ring]
      .filter(([colour, inRing]) => inRing >= OUTLINE_RATIO * (middle.get(colour) ?? 0) && !partner.has(colour))
      .map(([colour]) => colour),
  );
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

/** Result of `layoutAgreement`: how many sides of the reference layout the sheet's own art predicts. */
export interface LayoutAgreement {
  readonly agreeing: number;
  readonly total: number;
  /** Sides the art predicts differently, as `(column,row)<side>:<reference letter>→<predicted letter>`. */
  readonly disagreements: readonly string[];
}

const SIDE_NAMES = ["N", "E", "S", "W"] as const;
const LETTERS = ["o", "x", "d"] as const;

/** The 2-pixel band along each side (middle 12 pixels), N, E, S, W; transparent pixels read as `"t"`. */
function sideBands(sheet: SheetPixels, cell: CellLook): string[][] {
  const bands: string[][] = [[], [], [], []];
  const at = (x: number, y: number): string => colourAt(sheet, cell.column * STRIDE + x, cell.row * STRIDE + y) ?? "t";
  for (let depth = 0; depth < RING; depth++)
    for (let k = RING; k < CELL - RING; k++) {
      bands[0]?.push(at(k, depth));
      bands[1]?.push(at(CELL - 1 - depth, k));
      bands[2]?.push(at(k, CELL - 1 - depth));
      bands[3]?.push(at(depth, k));
    }
  return bands;
}

/**
 * Tests whether `sheet` shares the layout of `reference` (a measurement of another sheet) without classifying any
 * colour. It learns from the sheet itself how often each colour occurs in bands whose reference side letter is
 * `o`, `x` or `d`, then predicts every side of every look from the other looks only (leave one look out: all
 * variants of the look are held back) and counts the sides that come out as the reference says. A sheet with the
 * reference layout scores close to all sides; a sheet with another layout, or random labels, scores far lower,
 * because a held-back look's band colours then follow no side letter.
 */
export function layoutAgreement(sheet: SheetPixels, reference: readonly CellLook[]): LayoutAgreement {
  const cells = reference.filter((cell) => cellFits(sheet, cell.column, cell.row));
  const bands = cells.map((cell) => sideBands(sheet, cell));
  const counts = new Map<string, Record<string, number>>();
  const totals: Record<string, number> = { o: 0, x: 0, d: 0 };
  const tally = (index: number, sign: number): void => {
    bands[index]?.forEach((band, side) => {
      const letter = cells[index]?.sides[side] ?? "x";
      for (const colour of band) {
        const entry = counts.get(colour) ?? { o: 0, x: 0, d: 0 };
        entry[letter] = (entry[letter] ?? 0) + sign;
        counts.set(colour, entry);
        totals[letter] = (totals[letter] ?? 0) + sign;
      }
    });
  };
  cells.forEach((_, index) => {
    tally(index, 1);
  });
  const looks = new Map<string, number[]>();
  cells.forEach((cell, index) => {
    looks.set(lookOf(cell), [...(looks.get(lookOf(cell)) ?? []), index]);
  });
  // Only letters the reference uses compete; an unused letter would win on smoothing alone.
  const letters = LETTERS.filter((letter) => (totals[letter] ?? 0) > 0);
  let agreeing = 0;
  let total = 0;
  const disagreements: string[] = [];
  for (const members of looks.values()) {
    for (const index of members) tally(index, -1);
    for (const index of members) {
      const cell = cells[index];
      if (cell === undefined) continue;
      bands[index]?.forEach((band, side) => {
        let best = "";
        let bestScore = -Infinity;
        for (const letter of letters) {
          // Naive Bayes over the band's pixels, with half a count of smoothing for colours never seen with a letter.
          let score = 0;
          for (const colour of band)
            score += Math.log(((counts.get(colour)?.[letter] ?? 0) + 0.5) / ((totals[letter] ?? 0) + 1));
          if (score > bestScore) {
            bestScore = score;
            best = letter;
          }
        }
        const wanted = cell.sides[side] ?? "x";
        total++;
        if (best === wanted) agreeing++;
        else disagreements.push(`(${String(cell.column)},${String(cell.row)})${SIDE_NAMES[side] ?? ""}:${wanted}→${best}`);
      });
    }
    for (const index of members) tally(index, 1);
  }
  return { agreeing, total, disagreements };
}
