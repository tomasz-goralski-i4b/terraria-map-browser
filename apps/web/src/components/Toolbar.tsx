import { useAppStore } from "../store.js";

export function Toolbar(): React.JSX.Element {
  const status = useAppStore((state) => state.status);
  return (
    <nav className="toolbar" aria-label="Actions">
      <button type="button">Open .wld world</button>
      <button type="button" disabled>
        Connect Terraria assets
      </button>
      <span role="status">{status}</span>
    </nav>
  );
}
