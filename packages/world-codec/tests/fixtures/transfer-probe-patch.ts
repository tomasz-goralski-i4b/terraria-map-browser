// Patches postMessage before the real world Worker entry is evaluated; reports (after every "parsed" post) whether each unique
// output buffer was detached by the transfer.
const scope = globalThis as unknown as {
  postMessage: (message: unknown, options?: { transfer?: Transferable[] }) => void;
};
const original = scope.postMessage.bind(scope);

scope.postMessage = (message, options) => {
  const parsed = message as { type?: string; result?: { planes: Record<string, ArrayBufferView>; envelope: { source: Uint8Array } } };
  const buffers = parsed.type === "parsed" && parsed.result !== undefined
    ? [...new Set([...Object.values(parsed.result.planes).map((plane) => plane.buffer), parsed.result.envelope.source.buffer])]
    : [];
  original(message, options);
  if (buffers.length > 0) {
    original({ type: "probe", uniqueBuffers: buffers.length, detached: buffers.map((buffer) => buffer.byteLength === 0) });
  }
};

export {};
