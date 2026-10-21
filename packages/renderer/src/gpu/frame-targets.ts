/// <reference lib="dom" />

import { requireValue, type GpuPart } from "./gl.js";

/** An offscreen colour target the size of the canvas: scheduled frames are drawn into one and copied to the canvas. */
export interface FrameTarget {
  readonly texture: WebGLTexture;
  readonly framebuffer: WebGLFramebuffer;
  /** Depth for the sprites behind the blocks (OBJECT_BEHIND). */
  readonly depth: WebGLRenderbuffer;
  readonly width: number;
  readonly height: number;
}

/** The two offscreen targets scheduled frames alternate between: the last frame, and the next one drawn from it. */
export interface FrameTargets extends GpuPart {
  /** The target holding the last frame, if any. */
  readonly last: () => FrameTarget | undefined;
  /** The other target at `width` × `height`, created or resized as needed. */
  readonly next: (width: number, height: number) => FrameTarget;
  /** Makes the target `next` returned the last frame. */
  readonly swap: () => void;
}

export function createFrameTargets(gl: WebGL2RenderingContext): FrameTargets {
  let targets: (FrameTarget | undefined)[] = [];
  let current = 0;

  const remove = (target: FrameTarget): void => {
    gl.deleteTexture(target.texture);
    gl.deleteRenderbuffer(target.depth);
    gl.deleteFramebuffer(target.framebuffer);
  };

  return {
    last: () => targets[current],
    next: (width, height) => {
      const index = 1 - current;
      const existing = targets[index];
      if (existing?.width === width && existing.height === height) return existing;
      if (existing !== undefined) remove(existing);
      const texture = requireValue(gl.createTexture(), "a texture");
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, width, height);
      const framebuffer = requireValue(gl.createFramebuffer(), "a framebuffer");
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
      const depth = requireValue(gl.createRenderbuffer(), "a renderbuffer");
      gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
      // Depth and a stencil bit: sprite mode orders its passes by depth and marks the object pass's pixels.
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH24_STENCIL8, width, height);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_STENCIL_ATTACHMENT, gl.RENDERBUFFER, depth);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      const target = { texture, framebuffer, depth, width, height };
      targets[index] = target;
      return target;
    },
    swap: () => { current = 1 - current; },
    lost: () => { targets = []; },
    release: () => {
      // Sparse until both targets were used.
      for (const target of targets) if (target !== undefined) remove(target);
      targets = [];
    },
  };
}
