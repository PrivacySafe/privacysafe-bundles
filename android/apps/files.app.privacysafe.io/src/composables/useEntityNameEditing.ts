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
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { Ui3nEditableExpose } from '@v1nt1248/3nclient-lib';
import { useAppStore } from '@/store';
import { isValidEntityName } from '@shared/utils/fs-utils/entity-name';

/**
 * The name field of an FS entity (table row, tile). An invalid name is rejected
 * in the field itself; a rename that fails later is undone with revertName(),
 * which is passed to the 'rename' handler. Without it the field would keep the
 * rejected name, as the entity's name (the model value) does not change.
 */
export function useEntityNameEditing() {
  const { t } = useI18n();
  const appStore = useAppStore();
  const editableEl = ref<Ui3nEditableExpose>();

  function validateName(name: string): true | string {
    return isValidEntityName(name) || t('validation.text.invalid_name');
  }

  function onInvalidName(message: string) {
    appStore.$createNotice({ type: 'error', withIcon: true, content: message });
  }

  function revertName() {
    editableEl.value?.reset();
  }

  return { editableEl, validateName, onInvalidName, revertName };
}
