import { useAppStore } from "../store.js";

let confirmer: (() => Promise<boolean>) | null = null;

/** The app's question before unsaved edits are dropped (a dialog); without one, nothing asks. */
export function setDiscardConfirmer(confirm: (() => Promise<boolean>) | null): void {
  confirmer = confirm;
}

/** Whether the loaded world may be replaced or closed: no unsaved edits, or the user chose to discard them. */
export async function confirmDiscardChanges(): Promise<boolean> {
  if (!useAppStore.getState().unsavedChanges || confirmer === null) return true;
  return confirmer();
}
