import { useCallback, useEffect, useRef, useState } from "react";
import {
  CameraAnimator, clampCamera, createMapRenderer, fitWorld, terrariaMapPalette, visibleChunks, wheelPixels,
} from "@studio/renderer";
import type { Camera, MapRenderer, RenderableWorld, Size } from "@studio/renderer";
import { brushFootprint } from "@studio/world-model";
import { getDefaultAssetSession, useAssetStore } from "../assets/asset-session.js";
import { registerMapController, rendererLayers, useViewStore, type ToolId } from "../shell/view-store.js";
import { getBlockFraming } from "../world/block-framing.js";
import { beginBrush, finishBrush, moveBrush, subscribeBrushChanges, useBrushStore } from "../world/brush-session.js";
import { createBrushStabilizer } from "../world/brush-stabilizer.js";

const KEY_PAN_PIXELS_PER_MS = 0.384;
const KEY_ZOOM_FACTOR = 1.25;
const WHEEL_ZOOM_PER_PIXEL = 0.0015;
const PINCH_ZOOM_PER_PIXEL = 0.01;
/** A press that moves less than this (CSS pixels) before release is a click. */
const CLICK_SLOP = 4;

/** Fills the nearest positioned ancestor; inline so the map sizes itself without the app stylesheet. */
const CANVAS_STYLE: React.CSSProperties = {
  position: "absolute", inset: 0, width: "100%", height: "100%", touchAction: "none", cursor: "grab",
};
const TOOL_CURSORS: Partial<Record<ToolId, string>> = { inspect: "crosshair", brush: "crosshair", erase: "crosshair" };

// Overlays are positioned inline for the same reason: they must stay above the canvas and clickable.
const CONTROLS_STYLE: React.CSSProperties = { position: "absolute", top: 8, right: 8, zIndex: 1, display: "flex", gap: 4 };

interface Point {
  readonly x: number;
  readonly y: number;
}

/** Everything the input handlers mutate between renders; none of it is React state (no re-render per camera move). */
interface MapSession {
  readonly renderer: MapRenderer;
  readonly animator: CameraAnimator;
  readonly requestFrame: () => void;
  readonly keys: Set<string>;
  cameraDirty: boolean;
  pendingResize: Size | null;
  hoverTile: Point | null;
  world: RenderableWorld;
  camera: Camera;
  viewport: Size;
  /**
   * Pointer positions are kept in CSS pixels relative to the canvas, because a devicePixelRatio change rescales
   * the backing store under a resting pointer; they are converted to backing pixels only when used.
   */
  readonly pointers: Map<number, Point>;
  /** Last pointer position over the canvas (CSS pixels); null while the pointer is outside. */
  hover: Point | null;
}

/**
 * Hands the connected Terraria assets' atlas to the renderer and turns sprite mode on with the Sprites layer. Both are
 * cheap to repeat: the renderer ignores an unchanged atlas, and sprite mode is a uniform.
 */
function applySprites(renderer: MapRenderer, shown: boolean): void {
  try {
    renderer.setAtlas(getDefaultAssetSession().getAtlas());
  } catch (error) {
    // The GPU cannot hold the atlas: the map keeps its colours, and the user learns why.
    useAssetStore.setState({ notice: error instanceof Error ? error.message : String(error) });
  }
  renderer.setSpriteMode(shown);
}

/**
 * The canvas that owns the renderer and turns input into camera moves; it draws nothing itself. The tile under the
 * pointer and the zoom go to the view store for the status bar; the chrome reaches the camera through the registered
 * map controller.
 */
export function MapCanvas({ world }: { readonly world: RenderableWorld }): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const footprintRef = useRef<HTMLDivElement>(null);
  const sessionRef = useRef<MapSession | null>(null);
  const worldRef = useRef(world);
  const [error, setError] = useState<string | null>(null);
  const tool = useViewStore((state) => state.tool);
  const layers = useViewStore((state) => state.layers);
  // Every status change may come with another atlas (ready, disconnected, a failed rebuild); the renderer ignores an
  // unchanged one, so following each change is cheap. A rebuild keeps drawing the previous atlas until it is ready.
  const assetStatus = useAssetStore((state) => state.status);
  /**
   * The primary press that may become a click (pin a tile): where it went down, and whether it ever left the click
   * slop on its way (an out-and-back drag is still a drag).
   */
  const pressRef = useRef<{ readonly at: Point; moved: boolean } | null>(null);
  const brushPointer = useRef<number | null>(null);
  const brushTrail = useRef<{
    readonly filter: ReturnType<typeof createBrushStabilizer>;
    point: Point | null;
    time: number;
  } | null>(null);
  const cancelDrawing = (): void => {
    finishBrush(true);
    brushPointer.current = null;
    brushTrail.current = null;
  };

  /** Canvas backing-store pixels of a point in CSS pixels relative to the canvas, at the current canvas geometry. */
  const toBacking = useCallback((point: Point): Point => {
    const canvas = canvasRef.current;
    if (canvas === null || canvas.clientWidth === 0 || canvas.clientHeight === 0) return point;
    return { x: (point.x * canvas.width) / canvas.clientWidth, y: (point.y * canvas.height) / canvas.clientHeight };
  }, []);

  /** The status bar reports the tile under the resting pointer, so it is recomputed whenever the camera or world moves. */
  const refreshHover = useCallback((session: MapSession): void => {
    const hover = session.hover === null ? null : toBacking(session.hover);
    const tile = hover === null ? null : session.renderer.tileAt(hover.x, hover.y);
    const footprint = footprintRef.current;
    const selected = useViewStore.getState().tool;
    const brush = useBrushStore.getState();
    if (footprint !== null) {
      const trail = brushTrail.current;
      const placement = trail === null ? hover : trail.point === null ? null : toBacking(trail.point);
      const target = placement === null ? null : session.renderer.tileAt(placement.x, placement.y);
      const show = target !== null && brush.placementPreview && (selected === "brush" || selected === "erase") && brush.reason === null && session.pointers.size === 0;
      footprint.hidden = !show;
      const canvas = canvasRef.current;
      if (show && canvas !== null) {
        const offset = Math.floor(brush.size / 2);
        const left = Math.max(0, target.x - offset);
        const top = Math.max(0, target.y - offset);
        const right = Math.min(session.world.width, target.x - offset + brush.size);
        const bottom = Math.min(session.world.height, target.y - offset + brush.size);
        const scaleX = session.camera.zoom * canvas.clientWidth / canvas.width;
        const scaleY = session.camera.zoom * canvas.clientHeight / canvas.height;
        footprint.style.left = `${String((left - session.camera.x) * scaleX)}px`;
        footprint.style.top = `${String((top - session.camera.y) * scaleY)}px`;
        footprint.style.width = `${String((right - left) * scaleX)}px`;
        footprint.style.height = `${String((bottom - top) * scaleY)}px`;
        const svg = footprint.querySelector("svg");
        svg?.setAttribute("viewBox", `0 0 ${String(right - left)} ${String(bottom - top)}`);
        footprint.querySelector("path")?.setAttribute("d", brushFootprint(brush.size, brush.shape).filter((cell) => {
          const x = target.x + cell.x;
          const y = target.y + cell.y;
          return x >= left && x < right && y >= top && y < bottom;
        }).map((cell) => `M${String(target.x + cell.x - left)} ${String(target.y + cell.y - top)}h1v1h-1z`).join(""));
      }
    }
    const previous = session.hoverTile;
    if (previous?.x === tile?.x && previous?.y === tile?.y) return;
    session.hoverTile = tile;
    useViewStore.getState().setHoverTile(tile);
  }, [toBacking]);

  const drawBrushPoint = (session: MapSession, local: Point | null): void => {
    const point = local === null ? null : toBacking(local);
    const tile = point === null ? null : session.renderer.tileAt(point.x, point.y);
    moveBrush(tile?.x ?? -1, tile?.y ?? -1);
  };

  const applyCamera = useCallback((session: MapSession, camera: Camera): void => {
    session.camera = camera;
    session.renderer.setCamera(camera);
    useViewStore.getState().setZoom(camera.zoom);
    refreshHover(session);
    const canvas = canvasRef.current;
    if (canvas === null) return;
    canvas.dataset["camera"] = JSON.stringify(camera);
    canvas.dataset["visibleChunks"] = JSON.stringify(
      visibleChunks(camera, session.viewport, session.world).map((chunk) => [chunk.x, chunk.y]),
    );
  }, [refreshHover]);

  const queueCamera = (session: MapSession): void => {
    session.cameraDirty = true;
    session.requestFrame();
  };

  /** CSS pixels of a pointer event relative to the canvas. */
  const localPoint = (clientX: number, clientY: number): Point => {
    const canvas = canvasRef.current;
    if (canvas === null) return { x: clientX, y: clientY };
    const rect = canvas.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  };

  /** Creates the renderer and wires input for the mounted canvas; returns the teardown, or null when it failed. */
  const start = (canvas: HTMLCanvasElement): (() => void) | null => {
    let renderer: MapRenderer;
    try {
      renderer = createMapRenderer(canvas, {
        mapPalette: terrariaMapPalette,
        onSpritesPreparing: (preparing) => { useViewStore.getState().setSpritesPreparing(preparing); },
      });
    } catch (cause) {
      // Creating the renderer needs the mounted canvas, so its failure is only known after mounting.
      setError(cause instanceof Error ? cause.message : String(cause));
      return null;
    }
    let frame: number | null = null;
    const session: MapSession = {
      renderer, world: worldRef.current, camera: { x: 0, y: 0, zoom: 1 }, viewport: { width: 0, height: 0 },
      animator: new CameraAnimator({ x: 0, y: 0, zoom: 1 }, { width: 0, height: 0 }, worldRef.current, () => performance.now()),
      pointers: new Map(), hover: null, hoverTile: null, keys: new Set(), cameraDirty: false, pendingResize: null,
      requestFrame: () => {
        if (frame !== null) return;
        frame = window.requestAnimationFrame(() => {
          frame = null;
          if (session.pendingResize !== null) {
            const first = session.viewport.width === 0;
            const size = session.pendingResize;
            session.pendingResize = null;
            canvas.width = size.width;
            canvas.height = size.height;
            session.viewport = size;
            session.keys.clear();
            session.animator.reset(first ? fitWorld(size, session.world) : clampCamera(session.animator.current, size, session.world), size, session.world);
          }
          const { camera, settled } = session.animator.step();
          const trail = brushTrail.current;
          let brushSettled = true;
          if (trail !== null && useBrushStore.getState().active) {
            const now = performance.now();
            const sample = trail.filter.step(now - trail.time);
            trail.time = now;
            trail.point = sample.point;
            brushSettled = sample.settled;
            drawBrushPoint(session, sample.point);
          }
          if (session.cameraDirty || camera.x !== session.camera.x || camera.y !== session.camera.y || camera.zoom !== session.camera.zoom) {
            session.cameraDirty = false;
            applyCamera(session, camera);
          } else refreshHover(session);
          if (!settled || !brushSettled) session.requestFrame();
        });
      },
    };
    sessionRef.current = session;
    const unsubscribeBrushOptions = useBrushStore.subscribe((state) => {
      if (!state.active) { brushTrail.current = null; brushPointer.current = null; }
      session.requestFrame();
    });
    const unsubscribeTool = useViewStore.subscribe((state, previous) => {
      if (state.tool !== previous.tool) session.requestFrame();
    });
    renderer.setWorld(session.world);
    const unsubscribeEdits = subscribeBrushChanges((edited, tiles) => {
      if (edited.planes === session.world.planes) renderer.invalidateTiles(tiles);
    });
    renderer.setLayers(rendererLayers(useViewStore.getState().layers));
    applySprites(renderer, useViewStore.getState().layers.sprites);
    // Self-framed blocks (dirt, stone, ores, grass, …) keep their map colours until the framing database is inflated.
    let disposed = false;
    getBlockFraming().then((framing) => {
      if (!disposed) renderer.setFraming(framing);
    }, (cause: unknown) => {
      if (!disposed) useAssetStore.setState({ notice: `Block sprites are unavailable: ${cause instanceof Error ? cause.message : String(cause)}` });
    });

    const motionPreference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updateMotionPreference = (): void => {
      session.animator.setReducedMotion(motionPreference.matches);
      session.requestFrame();
    };
    updateMotionPreference();
    motionPreference.addEventListener("change", updateMotionPreference);

    const stopMotion = (): void => {
      finishBrush(true);
      brushPointer.current = null;
      session.keys.clear();
      session.animator.cancelMotion();
    };
    window.addEventListener("blur", stopMotion);

    const onWheel = (event: WheelEvent): void => {
      cancelDrawing();
      event.preventDefault();
      if (session.viewport.width === 0) return;
      session.keys.clear();
      const rate = event.ctrlKey ? PINCH_ZOOM_PER_PIXEL : WHEEL_ZOOM_PER_PIXEL;
      const point = toBacking(localPoint(event.clientX, event.clientY));
      session.animator.zoom(Math.exp(-wheelPixels(event.deltaY, event.deltaMode, canvas.clientHeight) * rate), point.x, point.y, event.ctrlKey);
      queueCamera(session);
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });

    const resize = (): void => {
      const width = Math.round(canvas.clientWidth * window.devicePixelRatio);
      const height = Math.round(canvas.clientHeight * window.devicePixelRatio);
      if (width === 0 || height === 0 || (width === canvas.width && height === canvas.height && session.viewport.width !== 0)) return;
      cancelDrawing();
      // Geometry and camera must change in the same frame, including the test hooks and resting-pointer status.
      session.pendingResize = { width, height };
      queueCamera(session);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    // A devicePixelRatio change (browser zoom, another monitor) can leave the CSS size untouched, so the
    // observer stays silent; browsers report it as a window resize.
    window.addEventListener("resize", resize);

    const zoomBy = (factor: number): void => {
      cancelDrawing();
      if (session.viewport.width === 0) return;
      session.keys.clear();
      session.animator.zoom(factor, session.viewport.width / 2, session.viewport.height / 2);
      queueCamera(session);
    };
    registerMapController({
      centerOn: (x, y) => {
        cancelDrawing();
        if (session.viewport.width === 0) return;
        session.keys.clear();
        session.animator.pan(0, 0); // settles which camera the next pan starts from
        const { target } = session.animator;
        session.animator.pan(session.viewport.width / 2 - (x + 0.5 - target.x) * target.zoom,
          session.viewport.height / 2 - (y + 0.5 - target.y) * target.zoom);
        queueCamera(session);
      },
      fitWorld: () => {
        zoomBy(fitWorld(session.viewport, session.world).zoom / session.animator.target.zoom);
      },
      actualSize: () => {
        zoomBy(1 / session.animator.target.zoom);
      },
      zoomTo: (zoom) => {
        zoomBy(zoom / session.animator.target.zoom);
      },
      jumpTo: (camera) => {
        cancelDrawing();
        if (session.viewport.width === 0) return;
        session.keys.clear();
        session.animator.reset(clampCamera(camera, session.viewport, session.world), session.viewport, session.world);
        applyCamera(session, session.animator.current);
      },
      renderNow: () => {
        renderer.render();
      },
      stats: () => renderer.stats(),
    });

    return () => {
      finishBrush(true);
      brushPointer.current = null;
      unsubscribeEdits();
      unsubscribeBrushOptions();
      unsubscribeTool();
      registerMapController(null);
      useViewStore.getState().setHoverTile(null);
      useViewStore.getState().setZoom(null);
      observer.disconnect();
      window.removeEventListener("resize", resize);
      canvas.removeEventListener("wheel", onWheel);
      window.removeEventListener("blur", stopMotion);
      motionPreference.removeEventListener("change", updateMotionPreference);
      if (frame !== null) window.cancelAnimationFrame(frame);
      disposed = true;
      renderer.dispose();
      sessionRef.current = null;
    };
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return undefined;
    // Creating the renderer (WebGL context, shader compile) is a long synchronous task, up to hundreds of milliseconds
    // with software GL. Started from a later task, it lets the commit that mounted the map (and the world summary next
    // to it) finish and paint first instead of stalling it.
    let teardown: (() => void) | null = null;
    const timer = window.setTimeout(() => {
      teardown = start(canvas);
    }, 0);
    return () => {
      window.clearTimeout(timer);
      teardown?.();
    };
    // The renderer lives as long as the canvas; later world changes are handled by the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // The renderer is created a task after mounting and starts with the world current at that time.
    worldRef.current = world;
    const session = sessionRef.current;
    if (session === null || session.world === world) return;
    session.world = world;
    // A pin names a tile of the world it was picked in.
    useViewStore.getState().setPinnedTile(null);
    session.keys.clear();
    session.pointers.clear();
    session.animator.reset(session.viewport.width === 0 ? session.camera : fitWorld(session.viewport, world), session.viewport, world);
    // The camera goes first: the renderer's first frame of the new world would otherwise use the previous world's
    // camera and start building the overview around the wrong place.
    applyCamera(session, session.animator.current);
    session.renderer.setWorld(world);
    session.cameraDirty = true;
    session.requestFrame();
  }, [world, applyCamera]);

  useEffect(() => {
    // Layers are a uniform in the renderer: switching them uploads nothing.
    const shown = rendererLayers(layers);
    sessionRef.current?.renderer.setLayers(shown);
    const canvas = canvasRef.current;
    if (canvas !== null) canvas.dataset["layers"] = JSON.stringify(shown);
  }, [layers]);

  useEffect(() => {
    const renderer = sessionRef.current?.renderer;
    if (renderer !== undefined) applySprites(renderer, layers.sprites);
  }, [assetStatus, layers.sprites]);

  /** Pins the tile under a backing-store point in the Inspector (Inspect tool). */
  const pinAt = (session: MapSession, point: Point): void => {
    const tile = session.renderer.tileAt(point.x, point.y);
    if (tile !== null) useViewStore.getState().setPinnedTile(tile);
  };

  const withSession = (action: (session: MapSession) => void): void => {
    const session = sessionRef.current;
    if (session !== null && session.viewport.width !== 0) action(session);
  };

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    withSession((session) => {
      const selected = useViewStore.getState().tool;
      if (brushPointer.current !== null) {
        finishBrush(true);
        brushPointer.current = null;
      }
      if ((selected === "brush" || selected === "erase") && event.isPrimary && event.button === 0 && session.pointers.size === 0) {
        const point = toBacking(localPoint(event.clientX, event.clientY));
        const tile = session.renderer.tileAt(point.x, point.y);
        if (tile === null || !beginBrush(selected === "erase")) return;
        session.animator.cancelMotion();
        session.keys.clear();
        brushPointer.current = event.pointerId;
        const local = localPoint(event.clientX, event.clientY);
        const strength = useBrushStore.getState().smoothing;
        brushTrail.current = { filter: createBrushStabilizer(local, strength), point: local, time: performance.now() };
        session.hover = local;
        moveBrush(tile.x, tile.y);
        session.requestFrame();
        try {
          event.currentTarget.setPointerCapture(event.pointerId);
        } catch {
          // A pointer that ended before capture can still finish its stroke over the canvas.
        }
        return;
      }
      session.keys.clear();
      session.animator.beginDrag();
      event.currentTarget.style.cursor = "grabbing";
      session.pointers.set(event.pointerId, localPoint(event.clientX, event.clientY));
      // Only a lone primary-button press can pin; a second finger, or another button, makes it a gesture.
      pressRef.current = session.pointers.size === 1 && event.isPrimary && event.button === 0
        ? { at: localPoint(event.clientX, event.clientY), moved: false }
        : null;
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // Only live pointers can be captured; dragging keeps working while the pointer stays over the canvas.
      }
    });
  };

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    withSession((session) => {
      const local = localPoint(event.clientX, event.clientY);
      if (brushPointer.current === event.pointerId) {
        if ((event.pointerType === "mouse" || event.pointerType === "pen") && event.buttons !== 1) {
          cancelDrawing();
          if (event.buttons !== 0) {
            session.animator.beginDrag();
            session.pointers.set(event.pointerId, local);
            pressRef.current = null;
            event.currentTarget.style.cursor = "grabbing";
          }
          session.hover = local;
          session.requestFrame();
          return;
        }
        const point = toBacking(local);
        const tile = session.renderer.tileAt(point.x, point.y);
        const trail = brushTrail.current;
        if (trail !== null) {
          const now = performance.now();
          trail.point = trail.filter.move(tile === null ? null : local, now - trail.time);
          trail.time = now;
          drawBrushPoint(session, trail.point);
        }
        session.hover = local;
        session.requestFrame();
        return;
      }
      const last = session.pointers.get(event.pointerId);
      const press = pressRef.current;
      if (press !== null && Math.hypot(local.x - press.at.x, local.y - press.at.y) >= CLICK_SLOP) press.moved = true;
      session.hover = local;
      if (last === undefined) {
        session.requestFrame();
        return;
      }
      const others = [...session.pointers].filter(([id]) => id !== event.pointerId).map(([, other]) => toBacking(other));
      session.pointers.set(event.pointerId, local);
      const point = toBacking(local);
      const previous = toBacking(last);
      const other = others[0];
      if (other === undefined) {
        session.animator.drag(point.x - previous.x, point.y - previous.y);
        queueCamera(session);
        return;
      }
      // Pinch: pan with the midpoint, zoom with the change of distance between the two pointers.
      const before = { x: (previous.x + other.x) / 2, y: (previous.y + other.y) / 2 };
      const after = { x: (point.x + other.x) / 2, y: (point.y + other.y) / 2 };
      const ratio = Math.hypot(point.x - other.x, point.y - other.y) / Math.max(1, Math.hypot(previous.x - other.x, previous.y - other.y));
      session.animator.pan(after.x - before.x, after.y - before.y);
      session.animator.zoom(ratio, after.x, after.y, true);
      queueCamera(session);
    });
  };

  const onPointerEnd = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    withSession((session) => {
      if (brushPointer.current === event.pointerId) {
        if (event.type === "pointerup") {
          const local = localPoint(event.clientX, event.clientY);
          const point = toBacking(local);
          brushTrail.current?.filter.move(session.renderer.tileAt(point.x, point.y) === null ? null : local);
          drawBrushPoint(session, brushTrail.current?.filter.finish() ?? null);
        }
        finishBrush(event.type !== "pointerup");
        brushPointer.current = null;
        return;
      }
      if (!session.pointers.delete(event.pointerId)) return;
      const press = pressRef.current;
      pressRef.current = null;
      if (event.type === "pointerup" && event.button === 0 && press !== null && useViewStore.getState().tool === "inspect") {
        const release = localPoint(event.clientX, event.clientY);
        // A click, not a drag: the pointer never left a few CSS pixels around the press.
        if (!press.moved && Math.hypot(release.x - press.at.x, release.y - press.at.y) < CLICK_SLOP) pinAt(session, toBacking(release));
      }
      if (session.pointers.size === 0) session.animator.endDrag(event.type !== "pointerup");
      else session.animator.beginDrag();
      session.requestFrame();
      event.currentTarget.style.cursor = TOOL_CURSORS[useViewStore.getState().tool] ?? "grab";
    });
  };

  const updateKeyPan = (session: MapSession): void => {
    const held = (name: string): number => session.keys.has(name) ? 1 : 0;
    const scale = toBacking({ x: 1, y: 1 });
    session.animator.keyPan((held("ArrowLeft") - held("ArrowRight")) * KEY_PAN_PIXELS_PER_MS * scale.x,
      (held("ArrowUp") - held("ArrowDown")) * KEY_PAN_PIXELS_PER_MS * scale.y);
    session.requestFrame();
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLCanvasElement>): void => {
    withSession((session) => {
      const { viewport } = session;
      const anchor = session.hover === null ? { x: viewport.width / 2, y: viewport.height / 2 } : toBacking(session.hover);
      if (event.key === "Enter" && useViewStore.getState().tool === "inspect") {
        event.preventDefault();
        pinAt(session, anchor);
        return;
      }
      const arrow = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key);
      const factor = { "+": KEY_ZOOM_FACTOR, "=": KEY_ZOOM_FACTOR, "-": 1 / KEY_ZOOM_FACTOR, _: 1 / KEY_ZOOM_FACTOR }[event.key];
      if (arrow || factor !== undefined) cancelDrawing();
      if (!arrow && factor === undefined) {
        session.keys.clear();
        session.animator.cancelMotion();
        return;
      }
      event.preventDefault();
      if (arrow) {
        if (session.keys.has(event.key)) return;
        session.keys.add(event.key);
        updateKeyPan(session);
      } else if (factor !== undefined) {
        session.keys.clear();
        session.animator.zoom(factor, anchor.x, anchor.y);
        queueCamera(session);
      }
    });
  };

  if (error !== null) return <p role="alert">The map cannot be drawn: {error}</p>;
  return (
    <>
      <canvas
        ref={canvasRef}
        style={{ ...CANVAS_STYLE, cursor: TOOL_CURSORS[tool] ?? CANVAS_STYLE.cursor }}
        data-tool={tool}
        tabIndex={0}
        aria-label="World map"
        data-map-palette={terrariaMapPalette.gameVersion}
        onContextMenu={(event) => { event.preventDefault(); }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onLostPointerCapture={onPointerEnd}
        onPointerLeave={() => {
          withSession((session) => {
            session.hover = null;
            session.requestFrame();
          });
        }}
        onKeyDown={onKeyDown}
        onKeyUp={(event) => {
          withSession((session) => {
            if (session.keys.delete(event.key)) updateKeyPan(session);
          });
        }}
        onBlur={() => {
          finishBrush(true);
          brushPointer.current = null;
          withSession((session) => {
            session.keys.clear();
            session.animator.cancelMotion();
          });
        }}
      />
      <div ref={footprintRef} className="brush-footprint" aria-hidden="true" hidden style={{ position: "absolute", pointerEvents: "none" }}><svg width="100%" height="100%"><path /></svg></div>
      <div className="map-controls" style={CONTROLS_STYLE}>
        <button
          type="button"
          className="button button-overlay"
          aria-keyshortcuts="F"
          onClick={() => {
            cancelDrawing();
            withSession((session) => {
              session.keys.clear();
              session.animator.zoom(fitWorld(session.viewport, session.world).zoom / session.animator.target.zoom,
                session.viewport.width / 2, session.viewport.height / 2);
              queueCamera(session);
            });
          }}
        >
          Fit world
        </button>
        <button
          type="button"
          className="button button-overlay"
          aria-keyshortcuts="1"
          onClick={() => {
            cancelDrawing();
            withSession((session) => {
              session.keys.clear();
              session.animator.zoom(1 / session.animator.target.zoom, session.viewport.width / 2, session.viewport.height / 2);
              queueCamera(session);
            });
          }}
        >
          1:1
        </button>
      </div>
    </>
  );
}
