import { useId, useState } from "react";
import { create } from "zustand";
import { Icon } from "../ui/Icon.js";
import { useModal } from "./dialogs.js";

export type ConfirmChoice = "confirm" | "alternative" | "cancel";

export interface ConfirmRequest {
  readonly title: string;
  readonly message: string;
  readonly confirmLabel: string;
  /** A destructive confirmation is drawn as a danger button. */
  readonly danger?: boolean;
  /** A third choice between confirming and cancelling, e.g. "Save As…". */
  readonly alternativeLabel?: string;
}

interface ConfirmState {
  readonly request: ConfirmRequest | null;
  readonly resolve: ((choice: ConfirmChoice) => void) | null;
}
const useConfirmStore = create<ConfirmState>()(() => ({ request: null, resolve: null }));

/** Asks a question in the app's modal dialog; resolves with the choice (Escape or the backdrop cancel). */
export function confirmAction(request: ConfirmRequest): Promise<ConfirmChoice> {
  useConfirmStore.getState().resolve?.("cancel");
  return new Promise((resolve) => {
    useConfirmStore.setState({ request, resolve });
  });
}

/** The one confirmation dialog of the app, mounted once. */
export function ConfirmDialog(): React.JSX.Element {
  const { request, resolve } = useConfirmStore();
  const titleId = useId();
  const [answer] = useState(() => (choice: ConfirmChoice): void => {
    const pending = useConfirmStore.getState().resolve;
    useConfirmStore.setState({ request: null, resolve: null });
    pending?.(choice);
  });
  const [cancel] = useState(() => (): void => { answer("cancel"); });
  const ref = useModal(request !== null, cancel);
  return (
    <dialog ref={ref} className="dialog confirm-dialog" aria-labelledby={titleId}>
      {request !== null && resolve !== null && (
        <>
          <header className="dialog-header">
            <h2 id={titleId}>{request.title}</h2>
            <button type="button" className="icon-button" aria-label="Close" onClick={cancel}><Icon name="close" /></button>
          </header>
          <div className="confirm-body">
            <p className="confirm-message">{request.message}</p>
            <footer className="dialog-footer">
              {request.alternativeLabel !== undefined && (
                <button type="button" className="button" onClick={() => { answer("alternative"); }}>{request.alternativeLabel}</button>
              )}
              <span className="dialog-footer-spacer" />
              <button type="button" className="button" autoFocus onClick={cancel}>Cancel</button>
              <button type="button" className={request.danger === true ? "button button-danger" : "button button-primary"} onClick={() => { answer("confirm"); }}>
                {request.confirmLabel}
              </button>
            </footer>
          </div>
        </>
      )}
    </dialog>
  );
}
