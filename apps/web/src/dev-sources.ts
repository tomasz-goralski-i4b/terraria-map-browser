import { devSources } from "./sources.js";
import { getDefaultAssetSession } from "./assets/asset-session.js";
import { getDefaultWorldSession } from "./world/world-session.js";
import { useAppStore } from "./store.js";

/** Returns a teardown when a dev URL was handled, including a rejected URL. */
export function startDevSources(): (() => void) | null {
  try {
    const sources = devSources(location.search, import.meta.env.DEV);
    if (sources === null) return null;
    const world = getDefaultWorldSession(), assets = getDefaultAssetSession();
    void world.open(sources.world);
    void assets.connectSource(sources.assets);
    return () => { world.cancel(); assets.cancel(); };
  } catch (error) {
    useAppStore.getState().setFailed({ code: "Source", offset: 0, fileName: "URL sources", message: error instanceof Error ? error.message : String(error) });
    return () => undefined;
  }
}
