export type ExportStage = "encoding" | "verifying";

export type ExportResponse =
  | { readonly type: "progress"; readonly stage: ExportStage }
  | { readonly type: "ready"; readonly output: ArrayBuffer }
  | { readonly type: "failed"; readonly message: string };
