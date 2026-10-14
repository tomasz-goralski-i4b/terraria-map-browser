import type { WorldChest } from "@studio/world-codec";
import type { Tile } from "@studio/world-model";

export interface EntitiesSource { readonly chests: readonly WorldChest[]; readonly tileAt: (x: number, y: number) => Tile }
export function EntitiesPanel(_props: { readonly source?: EntitiesSource }): React.JSX.Element {
  return <p className="panel-empty">Chests are not implemented.</p>;
}
