// Types for the custom browser commands registered in vitest.config.ts.
declare module "vitest/browser" {
  interface BrowserCommands {
    /** Base64 bytes of a generated world in packages/test-fixtures/worlds. */
    readWorldFixture: (file: string) => Promise<string>;
    setAppOffline: (offline: boolean) => Promise<void>;
  }
}

export {};
