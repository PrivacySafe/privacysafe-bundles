/*
 Copyright (C) 2026 3NSoft Inc.

 This program is free software: you can redistribute it and/or modify it under
 the terms of the GNU General Public License as published by the Free Software
 Foundation, either version 3 of the License, or (at your option) any later
 version.

 This program is distributed in the hope that it will be useful, but
 WITHOUT ANY WARRANTY; without even the implied warranty of
 MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 See the GNU General Public License for more details.

 You should have received a copy of the GNU General Public License along with
 this program. If not, see <http://www.gnu.org/licenses/>.
*/
import { useI18n } from 'vue-i18n';
import { readLink } from '@shared/utils/fs-utils';
import type { ListingEntryExtended } from '@shared/types';
import { useAppStore, useFsStore } from '@/store';

export function useOpenFsEntity() {
  const { t } = useI18n();
  const { openFile, getFs } = useFsStore();
  const appStore = useAppStore();

  /**
   * Opens the target of a link: a file is opened, a folder is shown by the
   * logical path of the link (`onFolder`), so that the breadcrumbs keep the link.
   */
  async function openLinkedEntity(
    fsId: string,
    entity: ListingEntryExtended,
    { onFolder }: { onFolder: (path: string) => void },
  ): Promise<void> {
    const { name, fullPath } = entity;

    const notifyBroken = () =>
      appStore.$createNotice({
        type: 'error',
        withIcon: true,
        content: t('fs.entity.message.error.broken_link', { name }),
      });

    if (entity.type === 'link-broken') {
      notifyBroken();
      return;
    }

    try {
      const fs = getFs(fsId);
      const link = await readLink({ fs, path: fullPath, stopErrorPropagate: true });
      if (!link) {
        notifyBroken();
        return;
      }

      // target() resolves the link to either a file or a folder
      await link.target();

      if (link.isFolder) {
        onFolder(fullPath);
        return;
      }

      if (link.isFile) {
        await openFile(fsId, fullPath, true);
        return;
      }

      notifyBroken();
    } catch {
      notifyBroken();
    }
  }

  return { openLinkedEntity };
}
