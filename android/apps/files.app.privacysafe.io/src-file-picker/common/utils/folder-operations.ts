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
