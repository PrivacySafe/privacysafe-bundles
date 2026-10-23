const INVALID_FILE_NAME_CHARACTERS = /[<>:"/\\|?*]/;
const WINDOWS_RESERVED_FILE_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

/**
 * Validates a name intended for use as a single file/folder name...not
 * a path. Used by both the save-filename field (usePickerState.ts) and
 * the collision-rename dialog (file-collision-dialog.vue), which can't
 * share a composable directly since it renders outside the picker's
 * provide/inject tree.
 */
export function isValidFileName(name: string): boolean {
  const trimmed = name.trim();

  if (!trimmed || trimmed === '.' || trimmed === '..') {
    return false;
  }

  if (INVALID_FILE_NAME_CHARACTERS.test(trimmed)) {
    return false;
  }

  const hasControlCharacter = Array.from(trimmed).some(character => character.charCodeAt(0) <= 31);
  if (hasControlCharacter) {
    return false;
  }

  if (WINDOWS_RESERVED_FILE_NAME.test(trimmed)) {
    return false;
  }
  return true;
}
