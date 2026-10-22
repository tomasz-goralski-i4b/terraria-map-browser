import { useEffect, useImperativeHandle, useRef } from "react";
import { minimapPixels, minimapSize, minimapTile, minimapViewRect, terrariaMapPalette, wheelPixels } from "@studio/renderer";
import type { Camera, RenderableWorld, Size } from "@studio/renderer";
import { useLayoutStore } from "../shell/layout-store.js";
import { getMapController } from "../shell/view-store.js";
import { subscribeBrushChanges } from "../world/brush-session.js";
import { getDefaultWorldSession } from "../world/world-session.js";

/** Backing pixels of the overview image at most; CSS scales it to the corner box. */
const IMAGE_WIDTH = 480;
const IMAGE_HEIGHT = 360;
const WHEEL_ZOOM_PER_PIXEL = 0.0015;
/** The view rectangle is drawn and grabbed at least this many CSS pixels across, however far the map zooms in. */
const MIN_VIEW_SIZE = 4;
/** Edits within this many milliseconds redraw the overview once. */
const EDIT_REDRAW_DELAY = 150;
const LAYERS = { background: true, walls: true, blocks: true, liquids: true, paint: true };
/** Inline like the map's other overlays, so it stays above the canvas without the app stylesheet. */
const STYLE: React.CSSProperties = { position: "absolute", top: 42, right: 8, zIndex: 1, touchAction: "none" };

export interface MinimapHandle {
  /** Moves the view rectangle to the camera's visible area; hides the minimap when that is the whole world. */
  readonly update: (camera: Camera, viewport: Size) => void;
}

/**
 * The whole world drawn small in the map's top-right corner, with a rectangle around what the map shows. The image is
 * drawn once per world (and again after edits); camera moves only move the rectangle. A click centres the map there,
 * dragging the rectangle pans, the wheel zooms around the view's centre.
 */
export function Minimap({ world, ref }: { readonly world: RenderableWorld; readonly ref: React.Ref<MinimapHandle> }): React.JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef<HTMLDivElement>(null);
  const last = useRef<{ camera: Camera; viewport: Size } | null>(null);
  const drag = useRef<{ readonly id: number; readonly x: number; readonly y: number; readonly camera: Camera; moved: boolean } | null>(null);
  const size = minimapSize(world, IMAGE_WIDTH, IMAGE_HEIGHT);

  const place = (): void => {
    const root = rootRef.current, view = viewRef.current, current = last.current;
    if (root === null || view === null) return;
    const rect = current === null ? null : minimapViewRect(current.camera, current.viewport, world, size);
    // Half a minimap pixel of slack: at "Fit world" the view is the whole world, give or take rounding.
    const whole = rect === null || (rect.x <= 0.5 && rect.y <= 0.5 && rect.width >= size.width - 1 && rect.height >= size.height - 1);
    root.hidden = whole || !useLayoutStore.getState().minimap;
    if (rect === null) return;
    view.style.left = `${String(rect.x / size.width * 100)}%`;
    view.style.top = `${String(rect.y / size.height * 100)}%`;
    view.style.width = `${String(rect.width / size.width * 100)}%`;
    view.style.height = `${String(rect.height / size.height * 100)}%`;
  };

  useImperativeHandle(ref, () => ({
    update: (camera, viewport) => {
      last.current = { camera, viewport };
      place();
    },
  }));

  // eslint-disable-next-line react-hooks/exhaustive-deps -- place reads the world and its size only
  useEffect(() => useLayoutStore.subscribe((state, previous) => { if (state.minimap !== previous.minimap) place(); }), [world]);

  useEffect(() => {
    const image = imageRef.current;
    const context = image?.getContext("2d");
    if (image === null || context === null || context === undefined) return undefined;
    // The camera of another world says nothing about this one; the map sends its new camera next.
    last.current = null;
    place();
    const draw = (): void => {
      const { pixels } = minimapPixels(world, size, {
        surfaceY: world.surfaceY, ...(world.rockY === undefined ? {} : { rockY: world.rockY }), layers: LAYERS, mapPalette: terrariaMapPalette,
      });
      context.putImageData(new ImageData(new Uint8ClampedArray(pixels), size.width, size.height), 0, 0);
      image.dataset["draws"] = String(Number(image.dataset["draws"] ?? 0) + 1);
    };
    draw();
    let timer: number | null = null;
    const unsubscribe = subscribeBrushChanges((edited) => {
      if (edited.planes !== world.planes || timer !== null) return;
      timer = window.setTimeout(() => { timer = null; draw(); }, EDIT_REDRAW_DELAY);
    });
    return () => {
      unsubscribe();
      if (timer !== null) window.clearTimeout(timer);
    };
    // The size follows the world's dimensions only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [world]);

  useEffect(() => {
    const root = rootRef.current;
    if (root === null) return undefined;
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault();
      getMapController()?.zoomBy(Math.exp(-wheelPixels(event.deltaY, event.deltaMode, root.clientHeight) * WHEEL_ZOOM_PER_PIXEL));
    };
    root.addEventListener("wheel", onWheel, { passive: false });
    return () => { root.removeEventListener("wheel", onWheel); };
  }, []);

  /** Minimap image pixels of a pointer event; the image sits inside the box's border. */
  const imagePoint = (event: React.PointerEvent): { readonly x: number; readonly y: number } => {
    const box = (imageRef.current ?? event.currentTarget).getBoundingClientRect();
    return { x: (event.clientX - box.left) * size.width / box.width, y: (event.clientY - box.top) * size.height / box.height };
  };
  const endDrag = (): void => { drag.current = null; };

  const loaded = getDefaultWorldSession().getLoadedWorld();
  const landmarks = loaded?.planes === world.planes ? loaded.details.spawnAndLandmarks : null;
  const marker = (label: string, point: { readonly x: number; readonly y: number }): React.JSX.Element | null =>
    point.x < 0 || point.y < 0 || point.x >= world.width || point.y >= world.height ? null : (
      <span className={`minimap-marker minimap-marker-${label.toLowerCase()}`} title={label}
        style={{ left: `${String((point.x + 0.5) / world.width * 100)}%`, top: `${String((point.y + 0.5) / world.height * 100)}%` }} />
    );

  return (
    <div
      ref={rootRef}
      className="minimap"
      style={{ ...STYLE, aspectRatio: `${String(size.width)} / ${String(size.height)}` }}
      hidden
      role="img"
      aria-label="Minimap"
      onPointerDown={(event) => {
        if (event.button !== 0 || last.current === null) return;
        event.preventDefault();
        const point = imagePoint(event);
        const { camera, viewport } = last.current;
        const rect = minimapViewRect(camera, viewport, world, size);
        // Grabbable as large as it is drawn (CSS keeps it MIN_VIEW_SIZE across).
        const slack = Math.max(0, MIN_VIEW_SIZE * size.width / event.currentTarget.getBoundingClientRect().width - Math.min(rect.width, rect.height)) / 2;
        const inside = point.x >= rect.x - slack && point.x <= rect.x + rect.width + slack && point.y >= rect.y - slack && point.y <= rect.y + rect.height + slack;
        let start = camera;
        if (!inside) {
          // Glide there; a drag that follows starts from where the glide is going, as editors' navigators do.
          const tile = minimapTile(point.x, point.y, world, size);
          const x = Math.floor(tile.x), y = Math.floor(tile.y);
          getMapController()?.centerOn(x, y);
          start = { ...camera, x: x + 0.5 - viewport.width / camera.zoom / 2, y: y + 0.5 - viewport.height / camera.zoom / 2 };
        }
        drag.current = { id: event.pointerId, ...point, camera: start, moved: false };
        try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* The pointer may already have ended. */ }
      }}
      onPointerMove={(event) => {
        const start = drag.current;
        if (start?.id !== event.pointerId) return;
        if (event.buttons === 0) { endDrag(); return; }
        const point = imagePoint(event);
        if (!start.moved && point.x === start.x && point.y === start.y) return;
        start.moved = true;
        const from = minimapTile(start.x, start.y, world, size), to = minimapTile(point.x, point.y, world, size);
        getMapController()?.jumpTo({ ...start.camera, x: start.camera.x + to.x - from.x, y: start.camera.y + to.y - from.y });
      }}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onLostPointerCapture={endDrag}
    >
      <canvas ref={imageRef} className="minimap-image" width={size.width} height={size.height} />
      {landmarks !== null && marker("Spawn", landmarks.spawn)}
      {landmarks !== null && marker("Dungeon", landmarks.dungeon)}
      <div ref={viewRef} className="minimap-view" />
    </div>
  );
}
