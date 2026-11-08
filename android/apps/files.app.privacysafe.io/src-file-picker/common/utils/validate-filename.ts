import { isValidEntityName } from '@shared/utils/fs-utils/entity-name';

const INVALID_FILE_NAME_CHARACTERS = /[<>:"|?*]/;
const WINDOWS_RESERVED_FILE_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
const MAX_NAME_LENGTH = 255;

/**
 * Validates a name of a single file or folder (not a path). The base rules are
 * the app-wide ones (isValidEntityName): not empty, no '/' or '\', not '.' or
 * '..', no control characters. `strict` adds the rules of Windows file systems
 * (reserved characters and names); use it for device storages only, as 3N
 * storages accept such names and the user must be able to pick existing ones.
 */
export function isValidFileName(name: string, { strict = true }: { strict?: boolean } = {}): boolean {
  const trimmed = name.trim();

  if (!isValidEntityName(trimmed) || trimmed.length > MAX_NAME_LENGTH) {
    return false;
  }

  if (!strict) {
    return true;
  }

  return !INVALID_FILE_NAME_CHARACTERS.test(trimmed) && !WINDOWS_RESERVED_FILE_NAME.test(trimmed);
}
