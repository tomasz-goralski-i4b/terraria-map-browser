import { Icon } from "../ui/Icon.js";
import { useModal } from "../shell/dialogs.js";
import { closeFolderHint, confirmFolderHint, useFolderHintStore } from "../world/world-directory-picker.js";

export function WorldFolderHint(): React.JSX.Element {
  const state = useFolderHintStore();
  const ref = useModal(state.open, closeFolderHint);
  return (
    <dialog ref={ref} className="dialog" aria-label="Choose your Terraria worlds folder">
      <header className="dialog-header">
        <h2>Choose your Terraria worlds folder</h2>
        <button type="button" className="icon-button" aria-label="Close folder explanation" onClick={closeFolderHint}><Icon name="close" /></button>
      </header>
      <div className="folder-hint-body">
        <p>Terraria normally saves local worlds here on Windows:</p>
        <code>Documents\My Games\Terraria\Worlds</code>
        <p>Choose that folder, or the folder where you keep your worlds. For Steam Cloud or tModLoader, choose the folder containing your .wld files.</p>
        <p>The picker starts in Documents and remembers the folder you choose.</p>
        <label><input type="checkbox" checked={state.dontShowAgain} onChange={(event) => { useFolderHintStore.setState({ dontShowAgain: event.target.checked }); }} /> Don't show again</label>
        <div className="folder-hint-actions"><button type="button" className="button button-primary" onClick={confirmFolderHint}>Choose folder…</button></div>
      </div>
    </dialog>
  );
}
