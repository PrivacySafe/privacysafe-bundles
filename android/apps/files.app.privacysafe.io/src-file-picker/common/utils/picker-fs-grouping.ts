import type { RootFsFolderView } from '@shared/types';
import type { DialogMode } from '@picker/common/types';
import { isSystemRoot } from '../../../shared/utils/fs-grouping.ts';

export { isSystemRoot };

export {
  groupFsRoots as groupPickerFsRoots,
  type FsCategory as PickerCategory,
  type FsCategoryKey as PickerCategoryKey,
} from '../../../shared/utils/fs-grouping.ts';

export function isRootAvailableInMode(
  root: Pick<RootFsFolderView, 'fsId'>,
  mode: DialogMode | null | undefined,
): boolean {
  return mode === 'openFile' || !isSystemRoot(root);
}
