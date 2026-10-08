import type { PickerFile } from '@picker/common/types';

const ALL_FILES_EXTENSIONS = new Set(['*', '*.*']);

function normalizeExtension(extension: string): string {
  return extension
    .trim()
    .replace(/^\*?\./, '')
    .toLowerCase();
}

function getFileName(name: string): string {
  const normalizedName = name.replaceAll('\\', '/');
  return normalizedName.slice(normalizedName.lastIndexOf('/') + 1);
}

function getFileExtension(name: string): string {
  const fileName = getFileName(name);
  const separatorIndex = fileName.lastIndexOf('.');
  if (separatorIndex <= 0 || separatorIndex === fileName.length - 1) {
    return '';
  }

  return fileName.slice(separatorIndex + 1).toLowerCase();
}

function getFilterExtensions(filters: web3n.shell.files.FileTypeFilter[]): string[] {
  return filters.flatMap(filter => filter.extensions.map(normalizeExtension)).filter(Boolean);
}

function matchesFilterExtension(name: string, extension: string): boolean {
  const fileName = getFileName(name).toLowerCase();
  return fileName.endsWith(`.${extension}`);
}

/**
 * Appends an extension when the user entered a save filename without one.
 * A concrete filter extension takes priority; otherwise the extension from
 * fallbackName is preserved. Wildcard filters don't contribute an extension
 * because they represent "All files".
 */
export function appendDefaultFileExtension(
  name: string,
  filters?: web3n.shell.files.FileTypeFilter[],
  fallbackName?: string,
): string {
  if (getFileExtension(name)) {
    return name;
  }

  // Avoid manufacturing a double dot for names such as `file.`. Broader
  // trailing-dot filename policy is separate from filter extension handling.
  if (name.lastIndexOf('.') > 0) {
    return name;
  }

  const filterExtension = filters
    ? getFilterExtensions(filters).find(extension => !ALL_FILES_EXTENSIONS.has(extension))
    : undefined;
  const defaultExtension = filterExtension || getFileExtension(fallbackName ?? '');

  return defaultExtension ? `${name}.${defaultExtension}` : name;
}

/**
 * Applies the file-dialog extension filters to files while always keeping
 * folders visible so the user can continue navigating through the picker.
 */
export function filterPickerFilesByType(
  entries: PickerFile[],
  filters?: web3n.shell.files.FileTypeFilter[],
): PickerFile[] {
  if (!filters?.length) {
    return entries;
  }

  const filterExtensions = getFilterExtensions(filters);
  if (filterExtensions.some(extension => ALL_FILES_EXTENSIONS.has(extension))) {
    return entries;
  }

  if (!filterExtensions.length) {
    return entries;
  }

  return entries.filter(entry => {
    if (entry.isFolder) {
      return true;
    }

    return filterExtensions.some(extension => matchesFilterExtension(entry.name, extension));
  });
}
