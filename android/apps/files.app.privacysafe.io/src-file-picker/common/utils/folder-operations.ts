export interface PickerFolderTarget {
  fs: web3n.files.WritableFS;
  path: string;
  name: string;
}

export function hasFileExceptionFlag(error: unknown, flag: keyof web3n.files.FileExceptionFlag): boolean {
  return typeof error === 'object' && error !== null && (error as web3n.files.FileExceptionFlag)[flag] === true;
}

export async function getFolderTargetStats(target: PickerFolderTarget): Promise<web3n.files.Stats | undefined> {
  try {
    return await target.fs.stat(target.path);
  } catch (error) {
    if (hasFileExceptionFlag(error, 'notFound')) {
      return undefined;
    }
    throw error;
  }
}

export function createFolderTarget(target: PickerFolderTarget): Promise<web3n.files.WritableFS> {
  // Exclusive creation also catches a folder appearing after the UI listing
  // was loaded. Never silently reuse an unconfirmed existing destination.
  return target.fs.writableSubRoot(target.path, { create: true, exclusive: true });
}

export function openFolderTarget(target: PickerFolderTarget): Promise<web3n.files.WritableFS> {
  // Returning a sub-root gives the caller the chosen folder's capability.
  // Do not return the browsing FS or create a missing "existing" folder.
  return target.fs.writableSubRoot(target.path, { create: false });
}

export interface SaveCollision {
  name: string;
  isFolder: boolean;
  isLink: boolean;
}

/**
 * Finds an entity that saving `name` into `folderPath` would hit. The FS is
 * asked directly, so hidden entities (not shown in the picker) count too. On a
 * device FS names are compared without case: macOS and Windows file systems
 * usually ignore it, and 'Report.txt' would replace 'report.txt'.
 */
export async function findSaveCollision(
  fs: web3n.files.FS,
  folderPath: string,
  name: string,
): Promise<SaveCollision | undefined> {
  let entries: web3n.files.ListingEntry[];
  try {
    entries = await fs.listFolder(folderPath || '/');
  } catch (error) {
    if (hasFileExceptionFlag(error, 'notFound')) {
      return undefined;
    }
    throw error;
  }

  const lowerName = name.toLowerCase();
  const entry =
    entries.find(e => e.name === name) ??
    (fs.type === 'device' ? entries.find(e => e.name.toLowerCase() === lowerName) : undefined);

  return entry ? { name: entry.name, isFolder: !!entry.isFolder, isLink: !!entry.isLink } : undefined;
}

/**
 * Flags for opening the file to save: a new file is created exclusively, so an
 * entity appearing meanwhile is never overwritten; an existing file is
 * overwritten only after the user confirmed it.
 */
export function saveFileFlags(overwrite: boolean): web3n.files.FileFlags {
  return overwrite ? { create: false, truncate: true } : { create: true, exclusive: true };
}
