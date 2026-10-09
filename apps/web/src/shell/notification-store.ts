import { create } from "zustand";

/**
 * Short-lived messages in the map's bottom-right corner (as in code editors): results of actions that finished in the
 * background, such as a saved world. They never cover the middle of the map and never take focus. Successes and
 * infos close themselves; errors stay until closed.
 */
export interface NotificationInput {
  readonly kind: "success" | "info" | "error";
  readonly title: string;
  readonly detail?: string;
  /** A button on the notification, e.g. "Download instead". */
  readonly action?: { readonly label: string; readonly run: () => void };
}

export interface AppNotification extends NotificationInput {
  readonly id: number;
}

interface NotificationState {
  readonly items: readonly AppNotification[];
}

export const useNotifications = create<NotificationState>()(() => ({ items: [] }));

export const NOTIFICATION_TIMEOUT_MS = 6000;
const LIMIT = 4;
let nextId = 1;
const timers = new Map<number, number>();

export function dismissNotification(id: number): void {
  const timer = timers.get(id);
  if (timer !== undefined) window.clearTimeout(timer);
  timers.delete(id);
  useNotifications.setState((state) => ({ items: state.items.filter((item) => item.id !== id) }));
}

export function notify(input: NotificationInput): number {
  const id = nextId++;
  useNotifications.setState((state) => ({ items: [...state.items, { ...input, id }].slice(-LIMIT) }));
  if (input.kind !== "error") {
    timers.set(id, window.setTimeout(() => {
      dismissNotification(id);
    }, NOTIFICATION_TIMEOUT_MS));
  }
  return id;
}

export function clearNotifications(): void {
  for (const timer of timers.values()) window.clearTimeout(timer);
  timers.clear();
  useNotifications.setState({ items: [] });
}
