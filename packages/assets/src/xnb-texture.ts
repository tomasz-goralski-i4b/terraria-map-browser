/** Size caps, checked before the buffer they protect is allocated. */
export interface XnbLimits {
  /** Largest accepted file, in bytes (the file-size field and the supplied view). */
  readonly maxFileBytes: number;
  /** Largest accepted decompressed payload, in bytes. */
  readonly maxDecompressedBytes: number;
  /** Largest accepted `width × height × 4`, in bytes. */
  readonly maxPixelBytes: number;
}

/** Caps applied when the caller passes none; far above any vanilla Terraria sheet. */
export const DEFAULT_XNB_LIMITS: XnbLimits = {
  maxFileBytes: 32 * 1024 * 1024,
  maxDecompressedBytes: 128 * 1024 * 1024,
  maxPixelBytes: 128 * 1024 * 1024,
};

/** Options of {@link readXnbTexture}. */
export interface XnbReadOptions {
  /** Overrides individual caps of {@link DEFAULT_XNB_LIMITS}. */
  readonly limits?: Partial<XnbLimits>;
}

/** A decoded `Texture2D`. */
export interface XnbTexture {
  readonly width: number;
  readonly height: number;
  /** `width × height × 4` bytes, rows top to bottom, R, G, B, A per pixel. */
  readonly rgba: Uint8Array;
}

/** Decodes an uncompressed or LZX-compressed Terraria `.xnb` `Texture2D` (docs/assets.md). */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- red-phase stub; the green phase uses both parameters
export function readXnbTexture(_bytes: Uint8Array, _options?: XnbReadOptions): XnbTexture {
  throw new Error("not implemented");
}
