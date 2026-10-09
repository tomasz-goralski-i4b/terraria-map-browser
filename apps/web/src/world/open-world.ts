import { getDefaultWorldSession } from "./world-session.js";
import { WORLD_PICKER_LOCATION, type OpenedWorldFile, type OpenWorldHandle } from "./world-file.js";
import { folderForWorld } from "./world-folder.js";
import { useAppStore } from "../store.js";

interface FilePickerWindow {
  showOpenFilePicker?: (options: {
    readonly multiple: false;
    readonly excludeAcceptAllOption: true;
    readonly types: readonly { readonly description: string; readonly accept: Record<string, readonly string[]> }[];
  }) => Promise<readonly OpenWorldHandle[]>;
}

async function pickWithFilePicker(picker: NonNullable<FilePickerWindow["showOpenFilePicker"]>): Promise<OpenedWorldFile | null> {
  try {
    const [handle] = await picker({
      ...WORLD_PICKER_LOCATION,
      multiple: false,
      excludeAcceptAllOption: true,
      types: [{ description: "Terraria world (.wld)", accept: { "application/x-terraria-world": [".wld"] } }],
    });
    return handle === undefined ? null : { file: await handle.getFile(), handle };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return null; // the user closed the picker
    throw error;
  }
}

/** The app's hidden `<input type="file">`, the fallback where `showOpenFilePicker` is missing. */
let fallbackInput: HTMLInputElement | null = null;

export function registerFileInput(input: HTMLInputElement | null): void {
  fallbackInput = input;
}

/** Opens the system file picker and loads the chosen world in the default session. */
export function chooseWorldFile(): void {
  const picker = (window as FilePickerWindow).showOpenFilePicker;
  if (picker === undefined) {
    fallbackInput?.click();
    return;
  }
  void pickWithFilePicker(picker.bind(window)).then(async (opened) => {
    if (opened !== null && opened.handle !== null) {
      const directory = await folderForWorld(opened.handle);
      await getDefaultWorldSession().open(opened.file, opened.handle, directory ?? undefined);
    }
  }).catch((error: unknown) => {
    useAppStore.getState().setFailed({ code: "Internal", offset: 0, fileName: "Selected world", message: error instanceof Error ? error.message : String(error) });
  });
}
