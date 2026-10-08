import { useCallback, useEffect, useRef, useState } from "react";
import {
  CameraAnimator, clampCamera, createMapRenderer, fitWorld, terrariaMapPalette, visibleChunks, wheelPixels,
} from "@studio/renderer";
import type { Camera, MapRenderer, RenderableWorld, Size } from "@studio/renderer";

const KEY_PAN_PIXELS_PER_MS = 0.384;
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
    const previous = session.hoverTile;
    if (previous?.x === tile?.x && previous?.y === tile?.y) return;
    session.hoverTile = tile;
    setHoverTile(tile);
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
      renderer = createMapRenderer(canvas, { mapPalette: terrariaMapPalette });
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
          if (session.cameraDirty || camera.x !== session.camera.x || camera.y !== session.camera.y || camera.zoom !== session.camera.zoom) {
            session.cameraDirty = false;
            applyCamera(session, camera);
          } else refreshHover(session);
          if (!settled) session.requestFrame();
        });
      },
    };
    sessionRef.current = session;
    renderer.setWorld(session.world);

    const motionPreference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updateMotionPreference = (): void => {
      session.animator.setReducedMotion(motionPreference.matches);
      session.requestFrame();
    };
    updateMotionPreference();
    motionPreference.addEventListener("change", updateMotionPreference);

    const stopMotion = (): void => {
      session.keys.clear();
      session.animator.cancelMotion();
    };
    window.addEventListener("blur", stopMotion);

    const onWheel = (event: WheelEvent): void => {
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

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", resize);
      canvas.removeEventListener("wheel", onWheel);
      window.removeEventListener("blur", stopMotion);
      motionPreference.removeEventListener("change", updateMotionPreference);
      if (frame !== null) window.cancelAnimationFrame(frame);
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
    session.keys.clear();
    session.pointers.clear();
    session.animator.reset(session.viewport.width === 0 ? session.camera : fitWorld(session.viewport, world), session.viewport, world);
    session.cameraDirty = true;
    session.requestFrame();
  }, [world]);

  const withSession = (action: (session: MapSession) => void): void => {
    const session = sessionRef.current;
    if (session !== null && session.viewport.width !== 0) action(session);
  };

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    withSession((session) => {
      session.keys.clear();
      session.animator.beginDrag();
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
      if (!session.pointers.delete(event.pointerId)) return;
      if (session.pointers.size === 0) session.animator.endDrag(event.type !== "pointerup");
      else session.animator.beginDrag();
      session.requestFrame();
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
      const arrow = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key);
      const factor = { "+": KEY_ZOOM_FACTOR, "=": KEY_ZOOM_FACTOR, "-": 1 / KEY_ZOOM_FACTOR, _: 1 / KEY_ZOOM_FACTOR }[event.key];
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
        style={CANVAS_STYLE}
        tabIndex={0}
        aria-label="World map"
        data-map-palette={terrariaMapPalette.gameVersion}
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
          withSession((session) => {
            session.keys.clear();
            session.animator.cancelMotion();
          });
        }}
      />
      <div className="map-controls" style={CONTROLS_STYLE}>
        <button
          type="button"
          onClick={() => {
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
          onClick={() => {
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
      <p role="status" className="map-status" style={STATUS_STYLE}>
        {hoverTile === null ? "—" : `${String(hoverTile.x)}, ${String(hoverTile.y)}`}
      </p>
    </>
  );
}
