/** A stable reference to world content — vanilla, mod, or an unknown runtime ID. */
export type ContentRef =
  | { kind: "vanilla"; id: number }
  | {
      kind: "mod";
      mod: string;
      internalName: string;
      runtimeId?: number;
      modVersion?: string;
    }
  | { kind: "unknown"; runtimeId: number };

export function isModContent(ref: ContentRef): ref is Extract<ContentRef, { kind: "mod" }> {
  return ref.kind === "mod";
}
