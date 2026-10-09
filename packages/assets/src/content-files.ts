import type { ContentDirectory, ContentEntry } from "./atlas-build.js";

/** A file from `<input type="file" webkitdirectory>`, as far as the atlas build needs it. */
export interface PickedFile {
  readonly name: string;
  /** Path from the picked folder, `/`-separated, starting with the picked folder's own name. */
  readonly webkitRelativePath: string;
  readonly size: number;
  readonly lastModified: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

/** The folder that directly holds the file (`Images` for `Content/Images/Tiles_0.xnb`). */
function parentName(file: PickedFile): string {
  const parts = file.webkitRelativePath.split("/");
  return parts.at(-2) ?? "";
}

function depth(file: PickedFile): number {
  return file.webkitRelativePath.split("/").length;
}

/**
 * The fallback where `showDirectoryPicker` is missing: files picked from a folder, seen as the `Images` directory the
 * atlas build reads. When the `Content` folder was picked, those are the files directly inside its `Images` folder;
 * when `Images` itself was picked, its top-level files. Sub-folders are never listed.
 */
export function filesToContentDirectory(files: readonly PickedFile[]): ContentDirectory {
  const inImages = files.filter((file) => depth(file) === 3 && parentName(file).toLowerCase() === "images");
  const listed = inImages.length > 0 ? inImages : files.filter((file) => depth(file) <= 2);
  return {
    getDirectoryHandle: (name) => Promise.reject(new DOMException(`no directory ${name}`, "NotFoundError")),
    entries: async function* (): AsyncGenerator<[string, ContentEntry]> {
      for (const file of listed) {
        await Promise.resolve();
        yield [file.name, { kind: "file", getFile: () => Promise.resolve(file) }];
      }
    },
  };
}
