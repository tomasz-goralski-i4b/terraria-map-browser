import { Icon } from "../ui/Icon.js";
import { useModal } from "../shell/dialogs.js";
import { closeWorldFolder, openFolderWorld, useWorldFolderStore } from "../world/world-folder.js";

export function WorldFolderDialog(): React.JSX.Element {
  const state = useWorldFolderStore();
  const ref = useModal(state.open, closeWorldFolder);
  const title = state.name === null ? "Open folder" : `Worlds in ${state.name}`;
  return (
    <dialog ref={ref} className="dialog" aria-label={title}>
      <header className="dialog-header">
        <h2>{title}</h2>
        <button type="button" className="icon-button" aria-label="Close folder" onClick={closeWorldFolder}><Icon name="close" /></button>
      </header>
      {state.error !== null && <p role="alert">{state.error}</p>}
      {state.loading && <p role="status">Looking for Terraria worlds…</p>}
      {!state.loading && state.files.length === 0 && state.error === null && <p>No .wld worlds in this folder.</p>}
      <ul className="world-folder-list">
        {state.files.map((name) => <li key={name}><button type="button" className="button" aria-label={`Open ${name}`} onClick={() => { void openFolderWorld(name); }}>{name}</button></li>)}
      </ul>
    </dialog>
  );
}
