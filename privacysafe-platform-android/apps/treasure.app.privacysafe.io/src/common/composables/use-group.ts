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
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { storeToRefs } from 'pinia';
import cloneDeep from 'lodash/cloneDeep';
import size from 'lodash/size';
import type { TreasureGroup } from '@shared/@types';
import { DEFAULT_GROUP } from '@shared/constants';
import { useRecordStore } from '@/common/stores/record.store';

const newGroupData: TreasureGroup = {
  id: '',
  name: '',
  description: '',
};

export function useGroup(group?: TreasureGroup) {
  const { t } = useI18n();

  const recordStore = useRecordStore();
  const { groups, recordsByGroups } = storeToRefs(recordStore);

  const isLoading = ref(false);
  const groupData = ref<TreasureGroup>(group ? cloneDeep(group) : cloneDeep(newGroupData));
  const initialGroupData = ref<TreasureGroup>(cloneDeep(groupData.value));
  const isFormValid = ref<boolean>(!!groupData.value.id);

  const recordsInGroup = computed(() =>
    groupData.value.id ? size(recordsByGroups.value[groupData.value.id]) : 0,
  );

  const isChanged = computed(
    () =>
      initialGroupData.value.name !== groupData.value.name ||
      initialGroupData.value.description !== groupData.value.description,
  );

  const nameRules = [
    (v: unknown) => !!v || t('groupDialog.form.fields.name.required'),
    (v: unknown) => isUniqueName(v as string) || t('groupDialog.form.fields.name.unique'),
  ];

  function isUniqueName(v: string) {
    const duplicate = Object.values(groups.value).find(
      gr => gr.name.toLowerCase() === v.toLowerCase() && gr.id !== groupData.value.id,
    );
    return !duplicate && v.toLowerCase() !== DEFAULT_GROUP.FAVORITES;
  }

  function handleInput(field: keyof TreasureGroup, value: string) {
    (groupData.value[field] as string) = value;
  }

  function onValidationFlagUpdate(value: boolean) {
    isFormValid.value = value;
  }

  return {
    t,
    isLoading,
    groupData,
    isFormValid,
    isChanged,
    recordsInGroup,
    nameRules,
    handleInput,
    onValidationFlagUpdate,
  };
}
