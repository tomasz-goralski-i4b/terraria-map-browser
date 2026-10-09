import { expect, test } from "vitest";
import { commands } from "vitest/browser";
import "./support/commands.js";

const APP_URL = "/pwa-app/index.html";

function openApp(): Promise<HTMLIFrameElement> {
  const frame = document.createElement("iframe");
  frame.src = APP_URL;
  document.body.append(frame);
  return new Promise((resolve, reject) => {
    frame.addEventListener("load", () => { resolve(frame); }, { once: true });
    frame.addEventListener("error", () => { reject(new Error("app frame failed to load")); }, { once: true });
  });
}

async function waitForOpenButton(frame: HTMLIFrameElement): Promise<void> {
  await expect.poll(
    () => frame.contentDocument?.body.textContent ?? "",
    { timeout: 10_000 },
  ).toContain("Open .wld world");
}

test("the built manifest is linked and valid", async () => {
  const html = await (await fetch(APP_URL)).text();
  expect(html).toContain('rel="manifest"');
  const manifest = (await (await fetch("/pwa-app/manifest.webmanifest")).json()) as {
    name: string;
    start_url: string;
    display: string;
    icons: { src: string }[];
  };
  expect(manifest.name).toBe("Terraria Map Studio");
  expect(manifest.start_url).toBe(".");
  expect(manifest.display).toBe("standalone");
  expect(manifest.icons.length).toBeGreaterThan(0);
});

test("the app shell loads offline after the first visit", async () => {
  // First visit (online): the page registers the service worker, which precaches the shell.
  const first = await openApp();
  await waitForOpenButton(first);
  const registration = await navigator.serviceWorker.getRegistration(APP_URL);
  expect(registration).toBeDefined();
  await expect.poll(() => registration?.active?.state, { timeout: 10_000 }).toBe("activated");

  await commands.setAppOffline(true);
  try {
    await expect(fetch(APP_URL, { cache: "no-store" })).rejects.toThrow();
    // Second visit (offline): navigation and assets are answered by the service worker's precache.
    const second = await openApp();
    await waitForOpenButton(second);
    const actions = [...(second.contentDocument?.querySelectorAll(".top-actions button") ?? [])].map((b) => b.textContent);
    expect(actions).toContain("Connect Terraria assets");
  } finally {
    await commands.setAppOffline(false);
    await registration?.unregister();
  }
}, 30_000);
