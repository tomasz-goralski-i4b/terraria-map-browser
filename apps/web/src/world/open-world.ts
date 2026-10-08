import { getDefaultWorldSession } from "./world-session.js";

interface FilePickerWindow {
  showOpenFilePicker?: (options: {
    readonly multiple: false;
    readonly types: readonly { readonly description: string; readonly accept: Record<string, readonly string[]> }[];
  }) => Promise<readonly { getFile(): Promise<File> }[]>;
}

async function pickWithFilePicker(picker: NonNullable<FilePickerWindow["showOpenFilePicker"]>): Promise<File | null> {
  try {
    const [handle] = await picker({
      multiple: false,
      types: [{ description: "Terraria world", accept: { "application/octet-stream": [".wld"] } }],
    });
    return (await handle?.getFile()) ?? null;
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
  void pickWithFilePicker(picker).then((file) => {
    if (file !== null) void getDefaultWorldSession().open(file);
  });
}
