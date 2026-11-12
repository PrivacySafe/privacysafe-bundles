import type { RootFsFolderView } from '@shared/types';
import type { DialogMode } from '@picker/common/types';

export {
  groupFsRoots as groupPickerFsRoots,
  type FsCategory as PickerCategory,
  type FsCategoryKey as PickerCategoryKey,
} from '@shared/utils/fs-grouping';

export function isSystemRoot(root: Pick<RootFsFolderView, 'fsId'>): boolean {
  return root.fsId.startsWith('system-');
}

export function isRootAvailableInMode(
  root: Pick<RootFsFolderView, 'fsId'>,
  mode: DialogMode | null | undefined,
): boolean {
  return mode === 'openFile' || !isSystemRoot(root);
}
