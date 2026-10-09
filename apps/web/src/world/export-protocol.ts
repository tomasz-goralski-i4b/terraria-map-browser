export type ExportResponse =
  | { readonly type: "progress"; readonly message: string }
  | { readonly type: "ready"; readonly output: ArrayBuffer }
  | { readonly type: "failed"; readonly message: string };
