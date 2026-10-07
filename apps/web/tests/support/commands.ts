// Types for the custom browser commands registered in vitest.config.ts.
declare module "vitest/browser" {
  interface BrowserCommands {
    setAppOffline: (offline: boolean) => Promise<void>;
  }
}

export {};
