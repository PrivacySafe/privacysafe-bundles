/*
 The dialog parameters come from another app and are not trusted: a malformed
 value must not break the picker UI (a broken listing would leave the calling
 app waiting until the window is closed).
*/


export const MAX_TITLE_LENGTH = 200;
export const MAX_BUTTON_LABEL_LENGTH = 40;
export const MAX_DEFAULT_PATH_LENGTH = 1024;
export const MAX_FILTERS = 50;
export const MAX_FILTER_EXTENSIONS = 100;
export const MAX_EXTENSION_LENGTH = 32;

/*
 Characters that the caller could use to disguise its text: line breaks (a title
 of many lines covers the dialog with instructions), other control characters,
 bidi overrides and isolates, zero-width spaces and a BOM.
*/
// eslint-disable-next-line no-control-regex
const HIDDEN_CHARACTERS = /[\u0000-\u001f\u007f-\u009f\u200b\u200e\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g;

/** One line of plain text, at most `maxLength` characters; '' for a non-string. */
export function normalizeText(value: unknown, maxLength = MAX_TITLE_LENGTH): string {
  if (typeof value !== 'string') {
    return '';
  }
  const line = value.replace(HIDDEN_CHARACTERS, ' ').replace(/\s+/g, ' ').trim();
  return line.length > maxLength ? `${line.slice(0, maxLength - 1)}…` : line;
}

/**
 * The default path of a save dialog. It becomes a name and a folder, so it is
 * not changed here: one with hidden characters or too long is dropped, and the
 * name and folder rules apply when it is parsed.
 */
export function normalizeOptionalText(value: unknown, maxLength = MAX_DEFAULT_PATH_LENGTH): string | undefined {
  if (typeof value !== 'string' || value.length > maxLength) {
    return undefined;
  }
  return new RegExp(HIDDEN_CHARACTERS.source).test(value) ? undefined : value;
}

/** Keeps only well-formed filters with string extensions; undefined when none is left. */
export function normalizeFilters(value: unknown): web3n.shell.files.FileTypeFilter[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const filters = value.slice(0, MAX_FILTERS).flatMap(filter => {
    if (!filter || typeof filter !== 'object' || !Array.isArray(filter.extensions)) {
      return [];
    }
    const extensions = (filter.extensions as unknown[])
      .slice(0, MAX_FILTER_EXTENSIONS)
      .filter(
        (ext): ext is string =>
          typeof ext === 'string' &&
          ext.trim().length > 0 &&
          ext.length <= MAX_EXTENSION_LENGTH &&
          !new RegExp(HIDDEN_CHARACTERS.source).test(ext),
      );
    if (extensions.length === 0) {
      return [];
    }
    return [{ name: normalizeText(filter.name), extensions }];
  });

  return filters.length > 0 ? filters : undefined;
}
