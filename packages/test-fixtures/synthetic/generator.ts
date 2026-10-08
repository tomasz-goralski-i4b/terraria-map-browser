export type WorkloadProfile = "sky-stone" | "dense" | "mixed";

export interface SyntheticWorldOptions {
  readonly seed: number;
  readonly profile?: WorkloadProfile;
  readonly width?: number;
  readonly height?: number;
}

export function generateSyntheticWorld(_options: SyntheticWorldOptions): Uint8Array {
  throw new Error("not implemented");
}

export function writeSyntheticWorld(_path: string, _options: SyntheticWorldOptions): number {
  throw new Error("not implemented");
}
