import { useRef } from "react";
import { useAppStore } from "../store.js";
import { getDefaultWorldSession } from "../world/world-session.js";

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

export function Toolbar(): React.JSX.Element {
  const status = useAppStore((state) => state.status);
  const input = useRef<HTMLInputElement>(null);

  const chooseWorld = (): void => {
    const picker = (window as FilePickerWindow).showOpenFilePicker;
    if (picker === undefined) {
      input.current?.click();
      return;
    }
    void pickWithFilePicker(picker).then((file) => {
      if (file !== null) void getDefaultWorldSession().open(file);
    });
  };

  return (
    <nav className="toolbar" aria-label="Actions">
      <button type="button" onClick={chooseWorld}>
        Open .wld world
      </button>
      <input
        ref={input}
        type="file"
        accept=".wld"
        hidden
        aria-label="World file"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = ""; // allow picking the same file again
          if (file !== undefined) void getDefaultWorldSession().open(file);
        }}
      />
      <button type="button" disabled>
        Connect Terraria assets
      </button>
      <span role="status">{status}</span>
    </nav>
  );
}
