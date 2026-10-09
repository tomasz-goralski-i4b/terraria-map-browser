import { useEffect, useId, useRef } from "react";
import { useModal } from "../shell/dialogs.js";
import { Icon } from "../ui/Icon.js";
import { ProgressBar } from "../ui/Progress.js";
import {
  chooseSaveFolder, closeSaveAs, confirmSave, downloadWorldCopy, setSaveFileName, useSaveStore, type SaveStage,
} from "../world/save-world.js";

const STAGE_TEXT: Readonly<Record<Exclude<SaveStage, "idle">, string>> = {
  permission: "Waiting for permission to write…",
  encoding: "Encoding the world…",
  verifying: "Reading the encoded world back to check it…",
  writing: "Writing the file…",
};

/** Selects the name without `.wld`, as save dialogs do, so typing replaces only the name. */
function selectBaseName(input: HTMLInputElement | null): void {
  if (input === null) return;
  input.focus();
  const end = input.value.toLowerCase().endsWith(".wld") ? input.value.length - 4 : input.value.length;
  input.setSelectionRange(0, end);
}

/** File ▸ Save As…: file name, destination folder, what is guaranteed, and Save / Download. */
export function SaveAsDialog(): React.JSX.Element {
  const state = useSaveStore();
  const ref = useModal(state.open, closeSaveAs);
  const titleId = useId();
  const nameId = useId();
  const working = state.stage !== "idle";
  const input = useRef<HTMLInputElement>(null);
  // After `useModal` has shown the dialog (its effect runs first), and again when the suggested name arrives.
  useEffect(() => {
    if (state.open) selectBaseName(input.current);
  }, [state.open, state.nameRevision]);
  const canSave = state.folderName !== null && !working;

  return (
    <dialog ref={ref} className="dialog save-dialog" aria-labelledby={titleId}>
      <header className="dialog-header">
        <h2 id={titleId}>Save World As</h2>
        <button type="button" className="icon-button" aria-label="Close" onClick={closeSaveAs}><Icon name="close" /></button>
      </header>
      {state.open && (
        <form
          className="save-body"
          onSubmit={(event) => {
            event.preventDefault();
            if (canSave) void confirmSave();
          }}
        >
          <div className="save-field">
            <label htmlFor={nameId}>File name</label>
            <input
              ref={input}
              id={nameId}
              className="text-input"
              type="text"
              spellCheck={false}
              autoComplete="off"
              value={state.fileName}
              disabled={working}
              onChange={(event) => {
                setSaveFileName(event.target.value);
              }}
            />
          </div>
          <div className="save-field">
            <span className="save-field-label">Save in</span>
            <div className="save-folder">
              <Icon name="folder" />
              {state.folderName === null
                ? <span className="muted">{state.canPickFolder ? "No folder chosen" : "This browser cannot save into folders"}</span>
                : <span className="save-folder-name" data-testid="save-folder">{state.folderName}</span>}
              {state.canPickFolder && (
                <button type="button" className="button button-small" disabled={working} onClick={() => void chooseSaveFolder()}>
                  {state.folderName === null ? "Choose Folder…" : "Change…"}
                </button>
              )}
            </div>
          </div>
          <ul className="save-facts" aria-label="What saving does">
            {state.formatVersion !== null && <li><Icon name="file" />Terraria world, format {state.formatVersion}, kept as it was opened</li>}
            <li><Icon name="check" />Encoded and read back before anything is written</li>
            <li><Icon name="lock" />The world you opened is never overwritten</li>
          </ul>
          {state.replacing && (
            <p className="save-notice save-notice-warning" role="alert">
              <Icon name="warning" />
              <span>“{state.fileName}” already exists in “{state.folderName}”. Replace it?</span>
            </p>
          )}
          {state.error !== null && (
            <p className="save-notice save-notice-error" role="alert">
              <Icon name="warning" />
              <span>{state.error}</span>
            </p>
          )}
          {working && (
            <div className="save-progress" role="status">
              <ProgressBar label="Saving" fraction={0} waiting />
              <span>{STAGE_TEXT[state.stage]}</span>
            </div>
          )}
          <footer className="dialog-footer">
            <button type="button" className="button" disabled={working} onClick={() => void downloadWorldCopy()}>
              <Icon name="download" />
              <span>Download</span>
            </button>
            <span className="dialog-footer-spacer" />
            <button type="button" className="button" onClick={closeSaveAs}>Cancel</button>
            <button type="submit" className={state.replacing ? "button button-danger" : "button button-primary"} disabled={!canSave}>
              {state.replacing ? "Replace" : "Save"}
            </button>
          </footer>
        </form>
      )}
    </dialog>
  );
}
