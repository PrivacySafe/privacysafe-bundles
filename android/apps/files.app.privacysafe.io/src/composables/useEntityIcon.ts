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
import { defineAsyncComponent, inject, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  DIALOGS_KEY,
  type DialogsPlugin,
  NOTIFICATIONS_KEY,
  type NotificationsPlugin,
  VUEBUS_KEY,
  type VueBusPlugin,
} from '@v1nt1248/3nclient-lib/plugins';
import { appStorageSrv } from '@/services/services-provider';
import { ENTITY_ICON_XATTR } from '@/utils/entity-icon';
import { getEntityNameAndParent } from '@shared/utils/fs-utils/get-entity-name-and-parent';
import type { AppGlobalEvents, ListingEntryExtended } from '@shared/types';
import type { EntityIconDialogData, EntityIconDialogEvent } from '@/components/dialogs/entity-icon-dialog.vue';
import { makeLogger } from '@shared/utils/logger';

const log = makeLogger('EntityIcon');

export function useEntityIcon() {
  const { t } = useI18n();
  const bus = inject<VueBusPlugin<AppGlobalEvents>>(VUEBUS_KEY)!;
  const dialogs = inject<DialogsPlugin>(DIALOGS_KEY)!;
  const notifications = inject<NotificationsPlugin>(NOTIFICATIONS_KEY)!;

  /** True while the editor is open: clicks in it are not "outside" for the panel that opened it. */
  const isIconEditorOpen = ref(false);

  /**
   * Opens the icon editor for the entity and writes the result into its xattr
   * `icon` (of a link — into the link itself). The folder of the entity is
   * reread, so that the table and the tiles show the change. Returns true when
   * the icon has been changed or removed.
   */
  async function editEntityIcon({
    fsId,
    entity,
  }: {
    fsId: string;
    entity: Pick<ListingEntryExtended, 'name' | 'fullPath' | 'icon'>;
  }): Promise<boolean> {
    const component = defineAsyncComponent(() => import('@/components/dialogs/entity-icon-dialog.vue'));

    isIconEditorOpen.value = true;
    const res = await dialogs
      .$openDialog<EntityIconDialogData, EntityIconDialogEvent>(component, {
        icon: entity.icon,
        dialogProps: { closeOnClickOverlay: false },
      })
      .finally(() => {
        // the click that closed the editor is still being dispatched
        setTimeout(() => {
          isIconEditorOpen.value = false;
        });
      });

    const path = entity.fullPath;
    try {
      if (res.event === 'confirm' && res.data?.icon) {
        await appStorageSrv.updateEntityXAttrs({ fsId, path, attrs: { [ENTITY_ICON_XATTR]: res.data.icon } });
      } else if (res.event === 'delete' && entity.icon) {
        await appStorageSrv.deleteEntityXAttrs({ fsId, path, attrNames: [ENTITY_ICON_XATTR] });
      } else {
        return false;
      }
    } catch (err) {
      log.error(`Error changing the icon of '${path}'. `, err);
      notifications.$createNotice({
        type: 'error',
        withIcon: true,
        content: t('fs.entity.message.error.icon', { name: entity.name }),
      });
      return false;
    }

    const { parentFolder } = getEntityNameAndParent(path);
    bus.$emitter.emit('refresh:data', { path: parentFolder || '' });
    return true;
  }

  return { isIconEditorOpen, editEntityIcon };
}
