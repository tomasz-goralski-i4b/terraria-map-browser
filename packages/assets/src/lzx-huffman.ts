const MAX_CODE_LENGTH = 16;
const TABLE_SIZE = 1 << MAX_CODE_LENGTH;

/**
 * A canonical Huffman decoding table (shorter codes first, equal lengths ordered by symbol), indexed by the next
 * 16 bits of the stream. An all-zero length table is legal and decodes nothing.
 */
export class HuffmanTable {
  private readonly symbols: Uint16Array = new Uint16Array(TABLE_SIZE);
  private readonly lengths: Uint8Array = new Uint8Array(TABLE_SIZE);

  /** Rebuilds the table from code lengths; returns false when the lengths are oversubscribed or incomplete. */
  build(codeLengths: ArrayLike<number>): boolean {
    const counts = new Array<number>(MAX_CODE_LENGTH + 1).fill(0);
    for (const length of Array.from(codeLengths)) counts[length] = (counts[length] ?? 0) + 1;
    counts[0] = 0;
    let capacity = 0;
    for (let length = 1; length <= MAX_CODE_LENGTH; length++) {
      capacity += (counts[length] ?? 0) << (MAX_CODE_LENGTH - length);
    }
    this.lengths.fill(0);
    if (capacity === 0) return true;
    if (capacity !== TABLE_SIZE) return false;

    const nextCode = new Array<number>(MAX_CODE_LENGTH + 1).fill(0);
    let code = 0;
    for (let length = 1; length <= MAX_CODE_LENGTH; length++) {
      nextCode[length] = code;
      code = (code + (counts[length] ?? 0)) << 1;
    }
    for (let symbol = 0; symbol < codeLengths.length; symbol++) {
      const length = codeLengths[symbol] ?? 0;
      if (length === 0) continue;
      const assigned = nextCode[length] ?? 0;
      nextCode[length] = assigned + 1;
      const first = assigned << (MAX_CODE_LENGTH - length);
      const last = first + (1 << (MAX_CODE_LENGTH - length));
      this.symbols.fill(symbol, first, last);
      this.lengths.fill(length, first, last);
    }
    return true;
  }

  /** Code length of the symbol whose code starts `window` (the next 16 bits); 0 when no code matches. */
  lengthAt(window: number): number {
    return this.lengths[window] ?? 0;
  }

  /** The symbol whose code starts `window` (the next 16 bits). */
  symbolAt(window: number): number {
    return this.symbols[window] ?? 0;
  }
}
