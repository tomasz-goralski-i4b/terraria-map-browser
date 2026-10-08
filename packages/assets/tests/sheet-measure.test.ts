import { describe, expect, it } from "vitest";
import {
  coloursOutside,
  compareLooks,
  formatSheetMap,
  groupLooks,
  layoutAgreement,
  measureSheet,
  missingRimCodes,
  nearColours,
  sheetColours,
  type CellLook,
  type SheetPixels,
} from "../tools/sheet-measure.ts";

type Rgb = readonly [number, number, number];
const BODY: Rgb = [100, 100, 100];
const OUTLINE: Rgb = [10, 10, 10];
const PARTNER: Rgb = [150, 100, 70];
const HIGHLIGHT: Rgb = [200, 150, 110];

// A synthetic sheet of `columns` × `rows` cells (stride 18), fully transparent until painted.
function blankSheet(columns: number, rows: number): SheetPixels {
  const width = columns * 18;
  const height = rows * 18;
  return { width, height, rgba: new Uint8Array(width * height * 4) };
}

function paint(sheet: SheetPixels, x: number, y: number, rgb: Rgb | undefined): void {
  const i = (y * sheet.width + x) * 4;
  sheet.rgba.set(rgb === undefined ? [0, 0, 0, 0] : [...rgb, 255], i);
}

interface CellArt {
  /** Sides (N, E, S, W) drawn with a 2-pixel outline, or with partner art. */
  readonly outline?: string;
  readonly partner?: string;
  /** Corners (NW, NE, SE, SW) cut away (transparent 2 × 2) or drawn with the highlight colour. */
  readonly cut?: readonly string[];
  readonly highlight?: readonly string[];
}

const SIDES = ["N", "E", "S", "W"] as const;
const CORNER_ORIGIN: Record<string, readonly [number, number]> = { NW: [0, 0], NE: [14, 0], SE: [14, 14], SW: [0, 14] };

function paintCell(sheet: SheetPixels, column: number, row: number, art: CellArt = {}): void {
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const band = (side: string): boolean =>
        (side === "N" && y < 2) || (side === "E" && x >= 14) || (side === "S" && y >= 14) || (side === "W" && x < 2);
      let rgb: Rgb = BODY;
      if (SIDES.some((side) => art.partner?.includes(side) === true && band(side))) rgb = PARTNER;
      if (SIDES.some((side) => art.outline?.includes(side) === true && band(side))) rgb = OUTLINE;
      paint(sheet, column * 18 + x, row * 18 + y, rgb);
    }
  for (const [corners, rgb] of [
    [art.cut ?? [], undefined],
    [art.highlight ?? [], HIGHLIGHT],
  ] as const)
    for (const corner of corners) {
      const [x0, y0] = CORNER_ORIGIN[corner] ?? [0, 0];
      for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) paint(sheet, column * 18 + x0 + x, row * 18 + y0 + y, rgb);
    }
}

const partnerColours = new Set([PARTNER.join(",")]);

describe("measureSheet", () => {
  it("measureSheet_OutlinedAndPlainCells_ReadClosedAndOpenSides", () => {
    const sheet = blankSheet(2, 1);
    paintCell(sheet, 0, 0, { outline: "NESW" });
    paintCell(sheet, 1, 0);

    const result = measureSheet(sheet, { rows: 1, columns: 2 });

    expect(result.outlineColours).toEqual([OUTLINE.join(",")]);
    expect(result.cells).toEqual([
      { column: 0, row: 0, sides: "xxxx", corners: "xxxx" },
      { column: 1, row: 0, sides: "oooo", corners: "oooo" },
    ]);
  });

  it("measureSheet_PartnerArtOnOneSide_ReadsRim", () => {
    const sheet = blankSheet(2, 1);
    paintCell(sheet, 0, 0, { partner: "N", outline: "S" });
    paintCell(sheet, 1, 0, { outline: "E" });

    const [rim] = measureSheet(sheet, { rows: 1, columns: 2, partnerColours }).cells;

    expect(rim?.sides).toBe("doxo");
  });

  it("measureSheet_PartnerColoursAreNeverOutline_EvenWhenOnlyInTheRing", () => {
    const sheet = blankSheet(1, 1);
    paintCell(sheet, 0, 0, { partner: "W" });

    expect(measureSheet(sheet, { rows: 1, columns: 1 }).outlineColours).toEqual([PARTNER.join(",")]);
    expect(measureSheet(sheet, { rows: 1, columns: 1, partnerColours }).outlineColours).toEqual([]);
  });

  it("measureSheet_CutCorner_ReadsNotch", () => {
    const sheet = blankSheet(1, 1);
    paintCell(sheet, 0, 0, { cut: ["NW", "SE"] });

    expect(measureSheet(sheet, { rows: 1, columns: 1 }).cells[0]?.corners).toBe("xoxo");
  });

  it("measureSheet_HighlightCorner_ReadsNotchOnlyWhenNamed", () => {
    const sheet = blankSheet(1, 1);
    paintCell(sheet, 0, 0, { highlight: ["NE"] });
    // The highlight colour also shades the body (2 middle pixels against 4 in the ring), so it is not an outline colour.
    paint(sheet, 8, 8, HIGHLIGHT);
    paint(sheet, 9, 8, HIGHLIGHT);

    expect(measureSheet(sheet, { rows: 1, columns: 1 }).cells[0]?.corners).toBe("oooo");
    const notchColours = new Set([HIGHLIGHT.join(",")]);
    expect(measureSheet(sheet, { rows: 1, columns: 1, notchColours }).cells[0]?.corners).toBe("oxoo");
  });

  it("measureSheet_OutlineColourAlsoShadingTheBody_IsStillOutline", () => {
    const sheet = blankSheet(2, 1);
    paintCell(sheet, 0, 0, { outline: "NESW" });
    paintCell(sheet, 1, 0);
    paint(sheet, 18 + 8, 8, OUTLINE); // one body pixel of the outline colour: ring 60 × outline, middle 1 ×

    const result = measureSheet(sheet, { rows: 1, columns: 2 });

    expect(result.outlineColours).toEqual([OUTLINE.join(",")]);
    expect(result.cells[0]?.sides).toBe("xxxx");
  });

  it("measureSheet_EmptyCellsAndCellsOutsideTheSheet_AreSkipped", () => {
    const sheet = blankSheet(2, 1);
    paintCell(sheet, 1, 0);

    const result = measureSheet(sheet);

    expect(result.cells.map((cell) => [cell.column, cell.row])).toEqual([[1, 0]]);
  });
});

describe("look helpers", () => {
  it("groupLooks_SameLook_KeepsReadingOrderAsVariantOrder", () => {
    const sheet = blankSheet(2, 2);
    paintCell(sheet, 1, 0);
    paintCell(sheet, 0, 1);
    paintCell(sheet, 0, 0, { outline: "N" });

    const looks = groupLooks(measureSheet(sheet).cells);

    expect([...looks.keys()]).toEqual(["xooo", "oooo/oooo"]);
    expect(looks.get("oooo/oooo")?.map((cell) => [cell.column, cell.row])).toEqual([
      [1, 0],
      [0, 1],
    ]);
  });

  it("missingRimCodes_NoRimCells_ListsAllSixtyFiveCodesWithD", () => {
    expect(missingRimCodes([])).toHaveLength(65);
    expect(missingRimCodes([{ column: 0, row: 0, sides: "dooo", corners: "oooo" }])).not.toContain("dooo");
  });

  it("formatSheetMap_EmptyCell_PrintsDashes", () => {
    const map = formatSheetMap([{ column: 1, row: 0, sides: "xoxo", corners: "oooo" }], 1, 2);

    expect(map.split("\n")[1]).toBe("  0  ---- xoxo");
  });

  it("compareLooks_DifferentCorner_ReportsTheCell", () => {
    const a = [{ column: 0, row: 0, sides: "oooo", corners: "oooo" }];
    const b = [{ column: 0, row: 0, sides: "oooo", corners: "xooo" }];

    expect(compareLooks(a, a)).toEqual([]);
    expect(compareLooks(a, b)).toEqual(["(0,0) oooo/oooo vs oooo/xooo"]);
  });

  it("sheetColours_ListsOpaqueColoursOnly", () => {
    const sheet = blankSheet(1, 1);
    paintCell(sheet, 0, 0, { outline: "N", cut: ["SW"] });

    expect([...sheetColours(sheet)].sort()).toEqual([BODY.join(","), OUTLINE.join(",")].sort());
  });
});

describe("partner colours", () => {
  it("coloursOutside_ColourUsedOnlyOutsideTheRegion_IsListed", () => {
    const sheet = blankSheet(2, 2);
    paintCell(sheet, 0, 0, { outline: "N" });
    paintCell(sheet, 1, 1, { partner: "N", outline: "S" });

    expect([...coloursOutside(sheet, { columns: 1, rows: 1 })]).toEqual([PARTNER.join(",")]);
  });

  it("nearColours_LightingVariantWithinTolerance_IsMatched", () => {
    const sheet = blankSheet(1, 1);
    paintCell(sheet, 0, 0);
    paint(sheet, 0, 0, [151, 101, 69]);
    const reference = new Set([PARTNER.join(",")]);

    expect([...nearColours(sheet, reference, 2)]).toEqual(["151,101,69"]);
    expect([...nearColours(sheet, reference, 0)]).toEqual([]);
  });
});

describe("layoutAgreement", () => {
  // Six looks, three variants each, one look per row; variants differ by one body pixel so they are not identical.
  const LOOKS: readonly CellArt[] = [
    { outline: "NESW" },
    {},
    { outline: "NS" },
    { outline: "EW" },
    { partner: "N", outline: "S" },
    { partner: "EW" },
  ];

  function layoutSheet(looks: readonly CellArt[]): SheetPixels {
    const sheet = blankSheet(3, looks.length);
    looks.forEach((art, row) => {
      for (let column = 0; column < 3; column++) {
        paintCell(sheet, column, row, art);
        paint(sheet, column * 18 + 8, row * 18 + 8, [100 + column, 100, 100]);
      }
    });
    return sheet;
  }

  const options = { rows: LOOKS.length, columns: 3, partnerColours };
  const reference: readonly CellLook[] = measureSheet(layoutSheet(LOOKS), options).cells;

  it("layoutAgreement_SheetWithTheReferenceLayout_PredictsEverySide", () => {
    const result = layoutAgreement(layoutSheet(LOOKS), reference);

    expect(result).toEqual({ agreeing: 72, total: 72, disagreements: [] });
  });

  it("layoutAgreement_ReferenceWithoutRims_NeverPredictsARim", () => {
    const withoutRims = LOOKS.slice(0, 4);
    const rimless = measureSheet(layoutSheet(withoutRims), { ...options, rows: withoutRims.length }).cells;

    expect(layoutAgreement(layoutSheet(withoutRims), rimless)).toEqual({ agreeing: 48, total: 48, disagreements: [] });
  });

  it("layoutAgreement_SheetWithAnotherLayout_DisagreesOnTheMovedSides", () => {
    // The same art turned by a quarter: every side letter moves to the next side (N → E → S → W → N).
    const turn = (sides = ""): string => sides.replace(/[NESW]/g, (side) => "ESWN"["NESW".indexOf(side)] ?? "");
    const moved = LOOKS.map((art) => ({ outline: turn(art.outline), partner: turn(art.partner) }));

    const result = layoutAgreement(layoutSheet(moved), reference);

    expect(result.agreeing).toBeLessThan(result.total / 2);
    expect(result.disagreements).toContain("(0,2)E:o→x"); // the outlined N/S look now has its outline on E/W
  });
});
