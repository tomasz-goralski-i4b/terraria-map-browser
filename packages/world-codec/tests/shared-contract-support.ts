/** Test-only RED seams. GREEN must use the existing TS codec and shared contracts. */
export interface VectorCase {
  readonly hex: string;
  readonly result?: Record<string, unknown>;
  readonly error?: Record<string, unknown>;
}

export interface ContractVector {
  readonly id: string;
  readonly entry: string;
  readonly context: Record<string, unknown>;
  readonly cases: readonly VectorCase[];
}

export interface VectorDocument {
  readonly schemaVersion: number;
  readonly group: string;
  readonly vectors: readonly ContractVector[];
}

export interface GoldenPair {
  readonly meta: Record<string, unknown>;
  readonly chunks: {
    readonly size: number;
    readonly planes: readonly string[];
    readonly digests: readonly Record<string, number | string>[];
  };
}

export const loadContractJson: (path: URL) => unknown = () => { throw new Error("not implemented"); };
export const validateVectorDocument: (document: unknown, name: string) => void = () => { throw new Error("not implemented"); };
export const decodeVectorCase: (vector: ContractVector, variant: VectorCase) => unknown = () => { throw new Error("not implemented"); };
export const assertVectorCase: (vector: ContractVector, variant: VectorCase) => void = () => { throw new Error("not implemented"); };
export const summarizeWorld: (bytes: Uint8Array, name: string) => GoldenPair = () => { throw new Error("not implemented"); };
export const loadWorldSummary: (path: URL) => GoldenPair = () => { throw new Error("not implemented"); };
export const validateGoldenPair: (pair: GoldenPair, name: string) => void = () => { throw new Error("not implemented"); };
export const assertGoldenPair: (actual: GoldenPair, expected: GoldenPair, name: string) => void = () => { throw new Error("not implemented"); };
