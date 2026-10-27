export interface DefaultSaveLocation {
  /** folder relative to the root the picker opens in; '' for the root itself */
  folderPath: string;
  fileName: string;
}

const EMPTY: DefaultSaveLocation = { folderPath: '', fileName: '' };

// paths of the caller's OS cannot be mapped onto a 3N storage: C:\..., ~/..., \\server\...
const OS_SPECIFIC_PATH = /^(?:[A-Za-z]:[\\/]|~[\\/]|\\\\)/;

/**
 * Parses the `defaultPath` of a save dialog into a folder and a file name.
 * The path is relative to the Home root ('/' marks that root). A trailing
 * separator means a folder without a file name. Paths of the caller's OS give
 * only the file name, and paths through '.', '..' or hidden folders (e.g. the
 * trash) give only the file name too. A folder that does not exist is handled
 * by the picker: it falls back to the root and keeps the file name.
 */
export function parseDefaultSaveLocation(defaultPath?: string): DefaultSaveLocation {
  const trimmed = (defaultPath ?? '').trim();
  if (!trimmed) {
    return EMPTY;
  }

  const isOsSpecific = OS_SPECIFIC_PATH.test(trimmed);
  const normalizedPath = trimmed.replaceAll('\\', '/');
  const pointsToFolder = normalizedPath.endsWith('/');
  const segments = normalizedPath.split('/').filter(Boolean);
  if (segments.length === 0) {
    return EMPTY;
  }

  const fileName = pointsToFolder ? '' : segments.pop()!;
  if (fileName === '.' || fileName === '..') {
    return EMPTY;
  }

  const isUnsafeFolder = segments.some(segment => segment === '.' || segment === '..' || segment.startsWith('.'));
  if (isOsSpecific || isUnsafeFolder) {
    return { folderPath: '', fileName };
  }

  return { folderPath: segments.join('/'), fileName };
}
