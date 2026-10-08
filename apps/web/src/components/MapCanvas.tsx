import { useCallback, useEffect, useRef, useState } from "react";
import {
  actualSize, clampCamera, createMapRenderer, fitWorld, panBy, terrariaMapPalette, visibleChunks, zoomAt,
} from "@studio/renderer";
import type { Camera, MapRenderer, RenderableWorld, Size } from "@studio/renderer";

const KEY_PAN_PIXELS = 64;
const KEY_ZOOM_FACTOR = 1.25;
const WHEEL_ZOOM_PER_PIXEL = 0.0015;
const PINCH_ZOOM_PER_PIXEL = 0.01;

/** Fills the nearest positioned ancestor; inline so the map sizes itself without the app stylesheet. */
const CANVAS_STYLE: React.CSSProperties = {
  position: "absolute", inset: 0, width: "100%", height: "100%", touchAction: "none", cursor: "grab",
};

// Overlays are positioned inline for the same reason: they must stay above the canvas and clickable.
const CONTROLS_STYLE: React.CSSProperties = { position: "absolute", top: 8, left: 8, zIndex: 1, display: "flex", gap: 8 };
const STATUS_STYLE: React.CSSProperties = { position: "absolute", bottom: 0, left: 0, zIndex: 1, margin: 0 };

interface Point {
  readonly x: number;
  readonly y: number;
}

/** Everything the input handlers mutate between renders; none of it is React state (no re-render per camera move). */
interface MapSession {
  readonly renderer: MapRenderer;
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

/** The canvas that owns the renderer and turns input into camera moves; it draws nothing itself. */
export function MapCanvas({ world }: { readonly world: RenderableWorld }): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sessionRef = useRef<MapSession | null>(null);
  const worldRef = useRef(world);
  const [error, setError] = useState<string | null>(null);
  const [hoverTile, setHoverTile] = useState<Point | null>(null);

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
    setHoverTile((previous) => {
      if (tile === null) return null;
      return previous !== null && previous.x === tile.x && previous.y === tile.y ? previous : { x: tile.x, y: tile.y };
    });
  }, [toBacking]);

  const applyCamera = useCallback((session: MapSession, camera: Camera): void => {
    session.camera = camera;
    session.renderer.setCamera(camera);
    refreshHover(session);
    const canvas = canvasRef.current;
    if (canvas === null) return;
    canvas.dataset["camera"] = JSON.stringify(camera);
    canvas.dataset["visibleChunks"] = JSON.stringify(
      visibleChunks(camera, session.viewport, session.world).map((chunk) => [chunk.x, chunk.y]),
    );
  }, [refreshHover]);

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
      renderer = createMapRenderer(canvas, { mapPalette: terrariaMapPalette });
    } catch (cause) {
      // Creating the renderer needs the mounted canvas, so its failure is only known after mounting.
      setError(cause instanceof Error ? cause.message : String(cause));
      return null;
    }
    const session: MapSession = {
      renderer, world: worldRef.current, camera: { x: 0, y: 0, zoom: 1 }, viewport: { width: 0, height: 0 },
      pointers: new Map(), hover: null,
    };
    sessionRef.current = session;
    renderer.setWorld(session.world);

    const onWheel = (event: WheelEvent): void => {
      event.preventDefault();
      const rate = event.ctrlKey ? PINCH_ZOOM_PER_PIXEL : WHEEL_ZOOM_PER_PIXEL;
      const point = toBacking(localPoint(event.clientX, event.clientY));
      applyCamera(session, zoomAt(session.camera, session.camera.zoom * Math.exp(-event.deltaY * rate), point.x, point.y,
        session.viewport, session.world));
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });

    const resize = (): void => {
      const width = Math.round(canvas.clientWidth * window.devicePixelRatio);
      const height = Math.round(canvas.clientHeight * window.devicePixelRatio);
      if (width === 0 || height === 0 || (width === canvas.width && height === canvas.height && session.viewport.width !== 0)) return;
      const first = session.viewport.width === 0;
      canvas.width = width;
      canvas.height = height;
      session.viewport = { width, height };
      applyCamera(session, first ? fitWorld(session.viewport, session.world) : clampCamera(session.camera, session.viewport, session.world));
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    // A devicePixelRatio change (browser zoom, another monitor) can leave the CSS size untouched, so the
    // observer stays silent; browsers report it as a window resize.
    window.addEventListener("resize", resize);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", resize);
      canvas.removeEventListener("wheel", onWheel);
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
    session.renderer.setWorld(world);
    applyCamera(session, session.viewport.width === 0 ? session.camera : fitWorld(session.viewport, world));
  }, [world, applyCamera]);

  const withSession = (action: (session: MapSession) => void): void => {
    const session = sessionRef.current;
    if (session !== null && session.viewport.width !== 0) action(session);
  };

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    withSession((session) => {
      session.pointers.set(event.pointerId, localPoint(event.clientX, event.clientY));
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
      const last = session.pointers.get(event.pointerId);
      session.hover = local;
      if (last === undefined) {
        refreshHover(session);
        return;
      }
      const others = [...session.pointers].filter(([id]) => id !== event.pointerId).map(([, other]) => toBacking(other));
      session.pointers.set(event.pointerId, local);
      const point = toBacking(local);
      const previous = toBacking(last);
      const other = others[0];
      if (other === undefined) {
        applyCamera(session, panBy(session.camera, point.x - previous.x, point.y - previous.y, session.viewport, session.world));
        return;
      }
      // Pinch: pan with the midpoint, zoom with the change of distance between the two pointers.
      const before = { x: (previous.x + other.x) / 2, y: (previous.y + other.y) / 2 };
      const after = { x: (point.x + other.x) / 2, y: (point.y + other.y) / 2 };
      const ratio = Math.hypot(point.x - other.x, point.y - other.y) / Math.max(1, Math.hypot(previous.x - other.x, previous.y - other.y));
      const panned = panBy(session.camera, after.x - before.x, after.y - before.y, session.viewport, session.world);
      applyCamera(session, zoomAt(panned, panned.zoom * ratio, after.x, after.y, session.viewport, session.world));
    });
  };

  const onPointerEnd = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    sessionRef.current?.pointers.delete(event.pointerId);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLCanvasElement>): void => {
    withSession((session) => {
      const { camera, viewport, world: current } = session;
      const pan = (dx: number, dy: number): Camera => panBy(camera, dx * KEY_PAN_PIXELS, dy * KEY_PAN_PIXELS, viewport, current);
      const anchor = session.hover === null ? { x: viewport.width / 2, y: viewport.height / 2 } : toBacking(session.hover);
      const zoom = (factor: number): Camera => zoomAt(camera, camera.zoom * factor, anchor.x, anchor.y, viewport, current);
      const next = {
        ArrowLeft: () => pan(1, 0),
        ArrowRight: () => pan(-1, 0),
        ArrowUp: () => pan(0, 1),
        ArrowDown: () => pan(0, -1),
        "+": () => zoom(KEY_ZOOM_FACTOR),
        "=": () => zoom(KEY_ZOOM_FACTOR),
        "-": () => zoom(1 / KEY_ZOOM_FACTOR),
        _: () => zoom(1 / KEY_ZOOM_FACTOR),
      }[event.key];
      if (next === undefined) return;
      event.preventDefault();
      applyCamera(session, next());
    });
  };

  if (error !== null) return <p role="alert">The map cannot be drawn: {error}</p>;
  return (
    <>
      <canvas
        ref={canvasRef}
        style={CANVAS_STYLE}
        tabIndex={0}
        aria-label="World map"
        data-map-palette={terrariaMapPalette.gameVersion}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onPointerLeave={() => {
          withSession((session) => {
            session.hover = null;
          });
          setHoverTile(null);
        }}
        onKeyDown={onKeyDown}
      />
      <div className="map-controls" style={CONTROLS_STYLE}>
        <button
          type="button"
          onClick={() => {
            withSession((session) => {
              applyCamera(session, fitWorld(session.viewport, session.world));
            });
          }}
        >
          Fit world
        </button>
        <button
          type="button"
          onClick={() => {
            withSession((session) => {
              applyCamera(session, actualSize(session.camera, session.viewport, session.world));
            });
          }}
        >
          1:1
        </button>
      </div>
      <p role="status" className="map-status" style={STATUS_STYLE}>
        {hoverTile === null ? "—" : `${String(hoverTile.x)}, ${String(hoverTile.y)}`}
      </p>
    </>
  );
}
