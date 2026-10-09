import { Session } from "node:inspector/promises";
import type { HeapProfiler } from "node:inspector";

// Node's inspector declarations omit these modern V8 protocol fields.
interface AllocationNode extends HeapProfiler.SamplingHeapProfileNode {
  id: number;
  children: AllocationNode[];
}

interface AllocationProfile extends HeapProfiler.SamplingHeapProfile {
  head: AllocationNode;
  samples: { nodeId: number }[];
}

/** Objects allocated by `action` inside calls of the function named `functionName`, garbage-collected ones included. */
export async function allocationCount(action: () => void, functionName: string): Promise<number> {
  const session = new Session();
  session.connect();
  try {
    // One-byte sampling captures object allocations; collected temporary objects must remain counted.
    const parameters = {
      samplingInterval: 1,
      includeObjectsCollectedByMajorGC: true,
      includeObjectsCollectedByMinorGC: true,
    };
    await session.post("HeapProfiler.startSampling", parameters);
    action();
    await session.post("HeapProfiler.collectGarbage");
    const { profile } = await session.post("HeapProfiler.stopSampling");
    const allocations = profile as AllocationProfile;
    const nodeIds = new Set<number>();
    function visit(node: AllocationNode, inside: boolean): void {
      const matches = inside || node.callFrame.functionName === functionName;
      if (matches) nodeIds.add(node.id);
      for (const child of node.children) visit(child, matches);
    }
    visit(allocations.head, false);
    return allocations.samples.filter((sample) => nodeIds.has(sample.nodeId)).length;
  } finally {
    session.disconnect();
  }
}
