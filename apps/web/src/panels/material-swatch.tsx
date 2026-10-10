import { useEffect, useMemo, useRef, useState } from "react";
import type { BrushContentLayer, ContentRef } from "@studio/world-model";
import { useAssetStore } from "../assets/asset-session.js";
import { getThumbnailSource, scheduleThumbnail } from "../assets/thumbnail-session.js";
import type { Thumbnail, TileThumbnailSource } from "../assets/thumbnails.js";
import { findMaterial, type BrushMaterials } from "../world/brush-materials.js";

/** A map colour (0xRRGGBB) as CSS; null (no map colour) shows the transparency checkerboard. */
export function cssColor(color: number | null | undefined): string | undefined {
  return color === null || color === undefined ? undefined : `#${color.toString(16).padStart(6, "0")}`;
}

export function paintColor(materials: BrushMaterials | null, paint: number): number | null {
  return paint === 0 ? null : materials?.paints.find((candidate) => candidate.id === paint)?.color ?? null;
}

export function paintLabel(materials: BrushMaterials | null, paint: number): string {
  if (paint === 0) return "No paint";
  return materials?.paints.find((candidate) => candidate.id === paint)?.name ?? `Paint ${String(paint)}`;
}

/** "Stone Block", "Wood Wall · Red Paint". */
export function swatchName(materials: BrushMaterials | null, layer: BrushContentLayer, id: number, paint = 0): string {
  const name = materials === null ? undefined : findMaterial(materials, layer, id)?.name;
  const base = name ?? `${layer === "block" ? "Block" : "Wall"} ${String(id)}`;
  return paint === 0 ? base : `${base} · ${paintLabel(materials, paint)}`;
}

/**
 * A material as image editors show a colour: its map colour, with the paint it is put down with as a corner, so a
 * painted and an unpainted swatch of the same block stay apart.
 */
export function MaterialSwatch({ color, paint, layer, content, actual, revision = 0 }: {
  readonly color: number | null;
  readonly paint?: number | null;
  readonly layer?: BrushContentLayer;
  readonly content?: ContentRef;
  readonly actual?: TileThumbnailSource | undefined;
  readonly revision?: number;
}): React.JSX.Element {
  const status = useAssetStore((state) => state.status);
  const host = useRef<HTMLSpanElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [image, setImage] = useState<{ readonly status: typeof status; readonly layer: BrushContentLayer; readonly content: ContentRef; readonly actual: typeof actual; readonly revision: number; readonly thumbnail: Thumbnail } | null>(null);
  const id = content?.kind === "vanilla" ? content.id : undefined;
  const reference = useMemo(() => id === undefined ? undefined : { kind: "vanilla", id } as const, [id]);
  // Retain the last cell while neighbours are being reframed; a changed connection or material hides it immediately.
  const thumbnail = image?.status === status && image.layer === layer && image.content === reference ? image.thumbnail : null;
  useEffect(() => {
    if (status.kind !== "ready" || layer === undefined || reference === undefined || host.current === null) return;
    let disposed = false;
    let visible = false;
    let request = 0;
    let cancel: (() => void) | undefined;
    const observer = new IntersectionObserver((entries) => {
      visible = entries.some((entry) => entry.isIntersecting);
      if (!visible) { request++; cancel?.(); cancel = undefined; return; }
      if (cancel !== undefined) return;
      const generation = ++request;
      let retriedAtlas = false;
      const build = (): void => {
        if (disposed || !visible || generation !== request) return;
        const source = getThumbnailSource();
        if (source === null) {
          cancel = undefined;
          if (!retriedAtlas) {
            retriedAtlas = true;
            cancel = scheduleThumbnail(build);
          }
          return;
        }
        void source.then((ready) => {
          if (disposed || !visible || generation !== request) return;
          cancel = scheduleThumbnail(() => {
            if (disposed || !visible || generation !== request) return;
            const result = actual === undefined ? ready.material(layer, reference) : ready.tile(layer, reference, actual);
            setImage(result === null ? null : { status, layer, content: reference, actual, revision, thumbnail: result });
            observer.disconnect();
          });
        }).catch(() => { /* Keep the exact map-colour fallback if framing cannot load. */ });
      };
      cancel = scheduleThumbnail(build);
    });
    observer.observe(host.current);
    return () => { disposed = true; observer.disconnect(); cancel?.(); };
  }, [status, layer, reference, actual, revision]);
  useEffect(() => {
    if (thumbnail === null || canvas.current === null) return;
    const context = canvas.current.getContext("2d");
    if (context === null) return;
    context.imageSmoothingEnabled = false;
    context.putImageData(new ImageData(thumbnail.pixels, thumbnail.width, thumbnail.height), 0, 0);
  }, [thumbnail]);
  const paintCss = cssColor(paint ?? null);
  return (
    <span ref={host} className="material-swatch" data-layer={layer} data-sprite={thumbnail !== null} data-empty={color === null} style={{ backgroundColor: cssColor(color) }} aria-hidden="true">
      {thumbnail !== null && <canvas ref={canvas} className="material-thumbnail" width={thumbnail.width} height={thumbnail.height} />}
      {paintCss !== undefined && <span className="material-swatch-paint" style={{ borderTopColor: paintCss }} />}
    </span>
  );
}
