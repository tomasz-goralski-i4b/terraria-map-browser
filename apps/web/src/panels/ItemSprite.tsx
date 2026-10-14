import { useLayoutEffect, useRef } from "react";
import { getDefaultAssetSession, useAssetStore } from "../assets/asset-session.js";
import { itemLabel, itemThumbnail } from "../world/items.js";

/** A single inventory frame, with a readable fallback without local assets. */
export function ItemSprite({ itemId, fallback = true }: { readonly itemId: number; readonly fallback?: boolean }): React.JSX.Element | null {
  const status = useAssetStore((state) => state.status);
  const atlas = status.kind === "ready" ? getDefaultAssetSession().getAtlas() : null;
  const thumbnail = atlas === null ? null : itemThumbnail(atlas, itemId);
  const canvas = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    if (thumbnail === null) return;
    canvas.current?.getContext("2d")?.putImageData(new ImageData(thumbnail.pixels, thumbnail.width, thumbnail.height), 0, 0);
  }, [thumbnail]);
  return thumbnail === null ? fallback ? <span className="chest-slot-item">{itemLabel(itemId)}</span> : null : <canvas aria-hidden="true" className="chest-item-sprite" ref={canvas} width={thumbnail.width} height={thumbnail.height} />;
}
