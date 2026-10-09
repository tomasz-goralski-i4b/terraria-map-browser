// Types for the custom browser commands registered in vitest.config.ts.
declare module "vitest/browser" {
  interface BrowserCommands {
    /** Base64 bytes of a generated world in packages/test-fixtures/worlds. */
    readWorldFixture: (file: string) => Promise<string>;
    setAppOffline: (offline: boolean) => Promise<void>;
    /**
     * Opt-in: a sprite atlas with only the given tile sheets, built from the local TERRARIA_CONTENT folder (pages as
     * base64), or null when the variable is unset.
     */
    buildLocalAtlas: (tileIds: readonly number[]) => Promise<{
      pageSize: number; pages: string[]; entries: unknown[]; missing: number;
    } | null>;
  }
}

export {};
