import type { ContentFolder } from "./assets/asset-session.js";

export interface WorldSource {
  readonly name: string;
  read(signal: AbortSignal): Promise<File>;
}

export interface AssetSource {
  readonly name: string;
  read(signal: AbortSignal): Promise<ContentFolder | readonly File[]>;
}

export function fileWorldSource(_file: File): WorldSource { throw new Error("not implemented"); }
export function folderAssetSource(_folder: ContentFolder): AssetSource { throw new Error("not implemented"); }
export function filesAssetSource(_files: readonly File[], _name: string): AssetSource { throw new Error("not implemented"); }
export function httpWorldSource(_url: string): WorldSource { throw new Error("not implemented"); }
export function httpAssetSource(_url: string): AssetSource { throw new Error("not implemented"); }
export function devSources(_search: string, _development: boolean): { world: WorldSource; assets: AssetSource } | null { throw new Error("not implemented"); }
