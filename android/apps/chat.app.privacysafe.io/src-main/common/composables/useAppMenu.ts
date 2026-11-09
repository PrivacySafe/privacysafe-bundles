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
// What the avatar menu offers, in ONE place for both form factors.
//
// The desktop menu and the phone drawer render it differently - a dropdown of
// rows against a column of buttons - but the set of actions, their order, their
// icons and what each one does are the same list. Two copies of that list would
// part ways on the first item added to one of them.
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { storeToRefs } from 'pinia';
import { useSettingsStore } from '@main/common/store/settings.store';
import type { AppMenuAction, AppMenuItem } from '~/app.types';

export function useAppMenuItems() {
  const { t } = useI18n();
  const { autoBackupInfo } = storeToRefs(useSettingsStore());

  return computed<AppMenuItem[]>(() => [
    { id: 'make-backup', icon: 'outline-file-download', label: t('app.menu.makeBackup') },
    { id: 'restore-backup', icon: 'outline-file-upload', label: t('app.menu.restoreBackup') },
    // Only when asked for in the settings: a new installation restores from
    // the automatic backups by itself, and on a device in use this is for when
    // something went wrong.
    ...(autoBackupInfo.value.settings.showAutoBackupRestore
      ? [{ id: 'restore-auto-backup' as const, icon: 'outline-cloud-download', label: t('app.menu.restoreAutoBackup') }]
      : []),
    { id: 'settings', icon: 'outline-settings', label: t('app.menu.settings') },
    { id: 'exit', icon: 'round-logout', label: t('app.menu.exit') },
  ]);
}

export type { AppMenuAction, AppMenuItem };
