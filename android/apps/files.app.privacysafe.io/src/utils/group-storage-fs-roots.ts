import {
  USER_FS,
  USER_LOCAL_FS,
  USER_TRASH_FOLDER,
  USER_TRASH_LOCAL_FOLDER,
} from '../../shared/constants/index.ts';
import type { RootFsFolderView } from '../../shared/types/index.ts';
import { groupFsRoots, getFsRootDisplayName } from '../../shared/utils/fs-grouping.ts';

/** Returns an i18n key or the literal root name. Section headings identify local and device storage. */
function getStorageFsRootNameKey(folder: RootFsFolderView): string {
  if (folder.id === `${USER_LOCAL_FS}-root`) {
    return 'fs.folder_name.user_synced_home';
  }

  if (folder.id === USER_TRASH_LOCAL_FOLDER) {
    return 'fs.folder_name.user_synced_trash';
  }

  return getFsRootDisplayName(folder);
}

export function getFsFolderLabel(
  folder: RootFsFolderView,
  fallbackLabelKey: string,
  t: (key: string) => string,
  te: (key: string) => boolean,
): string {
  const name = getStorageFsRootNameKey(folder) || fallbackLabelKey;
  return te(name) ? t(name) : name;
}

/** Groups Storage roots without changing File Picker's category rules. */
export function groupStorageFsRoots(fsFolderList: RootFsFolderView[]) {
  const userFsFolders = fsFolderList.filter(folder => [`${USER_FS}-root`, USER_TRASH_FOLDER].includes(folder.id));

  const localFsFolders = fsFolderList.filter(folder =>
    [`${USER_LOCAL_FS}-root`, USER_TRASH_LOCAL_FOLDER].includes(folder.id),
  );

  const fsCategories = [
    {
      key: 'local',
      labelKey: 'fs.category.local',
      roots: localFsFolders,
    },
    ...groupFsRoots(fsFolderList).filter(category => category.key !== 'home'),
  ].filter(category => category.roots.length > 0);

  const groupedIds = new Set([
    ...userFsFolders.map(folder => folder.id),
    ...fsCategories.flatMap(category => category.roots.map(folder => folder.id)),
  ]);

  const ungroupedFsFolders = fsFolderList.filter(folder => !groupedIds.has(folder.id));

  return { userFsFolders, fsCategories, ungroupedFsFolders };
}
