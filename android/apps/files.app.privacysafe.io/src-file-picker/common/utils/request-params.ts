/*
 The dialog parameters come from another app and are not trusted: a malformed
 value must not break the picker UI (a broken listing would leave the calling
 app waiting until the window is closed).
*/

export function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export function normalizeOptionalText(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/** Keeps only well-formed filters with string extensions; undefined when none is left. */
export function normalizeFilters(value: unknown): web3n.shell.files.FileTypeFilter[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const filters = value.flatMap(filter => {
    if (!filter || typeof filter !== 'object' || !Array.isArray(filter.extensions)) {
      return [];
    }
    const extensions = (filter.extensions as unknown[]).filter(
      (ext): ext is string => typeof ext === 'string' && ext.trim().length > 0,
    );
    if (extensions.length === 0) {
      return [];
    }
    return [{ name: normalizeText(filter.name), extensions }];
  });

  return filters.length > 0 ? filters : undefined;
}
