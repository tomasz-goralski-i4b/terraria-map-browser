// WebGL2 plumbing shared by the map renderer's parts: program linking, textures, unpack state and the part lifecycle.
/// <reference lib="dom" />

import type { RenderableWorld } from "./types.js";

/**
 * Texture units: 0–1 the chunk page; 2 palette; 3 background and paint colours; 4 map option rules; 5 overview (and the
 * scene the grid presents); 6 sprite atlas pages; 7 sprite sheet lookup; 8 the atlas pages at half resolution; 9 the
 * highlight's lookup or mask. WebGL2 guarantees 16.
 */
export const UNIT = {
  planes16: 0, planes8: 1, palette: 2, background: 3, rules: 4, overview: 5, atlas: 6, spriteSheets: 7, atlasHalf: 8,
  highlight: 9,
} as const;
export const TEXTURE_UNITS = 10;

/**
 * A part of the renderer that owns GL objects. `lost` forgets them after a context loss (they died with the context);
 * `release` deletes them on a live context. Either way the part creates what it needs again on its next use.
 */
export interface GpuPart {
  readonly lost: () => void;
  readonly release: () => void;
}

export interface Program<Name extends string> {
  readonly program: WebGLProgram;
  readonly uniforms: Readonly<Record<Name, WebGLUniformLocation>>;
}

/** A program's sources and the uniforms it looks up; the program cache links one per definition. */
export interface ProgramSource<Name extends string> {
  readonly vertex: string;
  readonly fragment: string;
  readonly uniforms: readonly Name[];
}

export function requireValue<T>(value: T | null, what: string): T {
  if (value === null) throw new Error(`WebGL2 could not create ${what}`);
  return value;
}

/** A program whose compiling and linking was started (startLink) and is checked by finishLink. */
export interface Linking {
  readonly program: WebGLProgram;
  readonly shaders: readonly WebGLShader[];
}

/**
 * Starts compiling and linking a program without asking for the result: with KHR_parallel_shader_compile the driver
 * works on it in the background until finishLink (or a COMPLETION_STATUS_KHR query says it is done).
 */
export function startLink(gl: WebGL2RenderingContext, vertex: string, fragment: string): Linking {
  const program = requireValue(gl.createProgram(), "a program");
  const shaders = [[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, fragment]] as const;
  const compiled = shaders.map(([type, source]) => {
    const shader = requireValue(gl.createShader(type), "a shader");
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    gl.attachShader(program, shader);
    return shader;
  });
  gl.linkProgram(program);
  return { program, shaders: compiled };
}

/**
 * Waits for a started link and looks up the program's uniforms; throws with the driver's log if it failed (the program
 * is deleted then). The shaders are deleted either way: a linked program keeps what it needs.
 */
export function finishLink<Name extends string>(gl: WebGL2RenderingContext, linking: Linking, names: readonly Name[]): Program<Name> {
  const { program } = linking;
  const linked = gl.getProgramParameter(program, gl.LINK_STATUS) as boolean;
  let failure: string | null = null;
  if (!linked) {
    const broken = linking.shaders.find((shader) => !(gl.getShaderParameter(shader, gl.COMPILE_STATUS) as boolean));
    failure = broken === undefined
      ? `Shader link failed: ${gl.getProgramInfoLog(program) ?? "unknown error"}`
      : `Shader compilation failed: ${gl.getShaderInfoLog(broken) ?? "unknown error"}`;
  }
  for (const shader of linking.shaders) {
    gl.detachShader(program, shader);
    gl.deleteShader(shader);
  }
  if (failure !== null) {
    gl.deleteProgram(program);
    throw new Error(failure);
  }
  const uniforms = Object.fromEntries(
    names.map((name) => [name, requireValue(gl.getUniformLocation(program, name), `uniform ${name}`)]),
  ) as Record<Name, WebGLUniformLocation>;
  return { program, uniforms };
}

/** Programs linked at once on their first use, one per definition. */
export interface ProgramCache extends GpuPart {
  readonly get: <Name extends string>(source: ProgramSource<Name>) => Program<Name>;
}

export function createProgramCache(gl: WebGL2RenderingContext): ProgramCache {
  const programs = new Map<ProgramSource<string>, Program<string>>();
  return {
    get: <Name extends string>(source: ProgramSource<Name>): Program<Name> => {
      const cached = programs.get(source);
      if (cached !== undefined) return cached;
      const linked = finishLink(gl, startLink(gl, source.vertex, source.fragment), source.uniforms);
      programs.set(source, linked);
      return linked;
    },
    lost: () => { programs.clear(); },
    release: () => {
      for (const { program } of programs.values()) gl.deleteProgram(program);
      programs.clear();
    },
  };
}

/** KHR_parallel_shader_compile, when the browser offers it. */
export interface ParallelShaderCompile {
  readonly COMPLETION_STATUS_KHR: number;
}

export function parallelShaderCompile(gl: WebGL2RenderingContext): ParallelShaderCompile | null {
  const extension: ParallelShaderCompile | null = gl.getExtension("KHR_parallel_shader_compile");
  return extension;
}

export function bindTexture(gl: WebGL2RenderingContext, unit: number, target: number, texture: WebGLTexture | null): void {
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(target, texture);
}

/** An immutable 2D texture, NEAREST filtered, bound to the active unit. */
export function integerTexture(gl: WebGL2RenderingContext, format: number, width: number, height: number): WebGLTexture {
  const texture = requireValue(gl.createTexture(), "a texture");
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texStorage2D(gl.TEXTURE_2D, 1, format, width, height);
  // Integer textures are incomplete unless they use NEAREST filtering.
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  return texture;
}

/** An immutable 2D array texture, NEAREST filtered, bound to the active unit. */
export function arrayTexture(gl: WebGL2RenderingContext, format: number, size: number, layers: number): WebGLTexture {
  const texture = requireValue(gl.createTexture(), "a texture");
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, texture);
  gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, format, size, size, layers);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  return texture;
}

/**
 * Sets GL's default unpack state. The context belongs to the canvas, not the renderer: a previous renderer on the
 * same canvas, or other code, may have left any state behind.
 */
export function defaultUnpack(gl: WebGL2RenderingContext): void {
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
  gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 0);
  gl.pixelStorei(gl.UNPACK_IMAGE_HEIGHT, 0);
  gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, 0);
  gl.pixelStorei(gl.UNPACK_SKIP_ROWS, 0);
  gl.pixelStorei(gl.UNPACK_SKIP_IMAGES, 0);
}

/**
 * The unpack state chunk uploads leave behind. They set it once per world (alignment, row length, image height) and
 * then only move the skip parameters; every other upload calls `reset` first, which restores GL's defaults.
 */
export interface UnpackState extends GpuPart {
  /** Sets the plane unpack state of `world` unless it is set already. */
  readonly forWorld: (world: RenderableWorld) => void;
  readonly reset: () => void;
}

export function createUnpackState(gl: WebGL2RenderingContext): UnpackState {
  // The world the plane unpack state is set for; null for GL's defaults, which the context may not hold yet.
  let world: RenderableWorld | null = null;
  defaultUnpack(gl);
  const reset = (): void => {
    if (world === null) return;
    defaultUnpack(gl);
    world = null;
  };
  return {
    forWorld: (source) => {
      if (world === source) return;
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.pixelStorei(gl.UNPACK_ROW_LENGTH, source.height);
      // A 3D upload must fit its skipped rows within the image height, which defaults to the upload's own height.
      gl.pixelStorei(gl.UNPACK_IMAGE_HEIGHT, source.width);
      world = source;
    },
    reset,
    // A restored context starts with the default unpack state.
    lost: () => { world = null; },
    // The context outlives the renderer: leave it with the default unpack state.
    release: () => {
      if (gl.isContextLost()) world = null;
      else reset();
    },
  };
}

/** Counters the parts add to; read by `MapRenderer.stats`. */
export interface Counters {
  textureUploads: number;
}
