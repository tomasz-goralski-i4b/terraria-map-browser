const scope = globalThis as unknown as {
  postMessage: (message: unknown, options?: { transfer?: Transferable[] }) => void;
};
const original = scope.postMessage.bind(scope);
scope.postMessage = (message, options) => {
  const response = message as { type?: string; output?: ArrayBuffer };
  const output = response.type === "saved" ? response.output : undefined;
  original(message, options);
  if (output !== undefined) original({ type: "save-probe", detached: output.byteLength === 0, transfers: options?.transfer?.length ?? 0 });
};
export {};
