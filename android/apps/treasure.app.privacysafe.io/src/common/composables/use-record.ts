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
import difference from 'lodash/difference';
import isEmpty from 'lodash/isEmpty';
import { useRecordStore } from '@/common/stores/record.store';
import type {
  ProcessedImage,
  TreasureBankCardRecord,
  TreasureCardRecord,
  TreasurePasswordRecord,
  TreasureRecord,
} from '@shared/@types';
import { DEFAULT_GROUP, RECORD_TYPE, RECORD_TYPES } from '@shared/constants.ts';

const newPasswordRecordData: TreasurePasswordRecord = {
  id: 'new',
  resource: '',
  name: '',
  username: '',
  password: '',
  group: '',
  isFavorite: false,
  type: RECORD_TYPE.PASSWORD,
};

const newCardRecordData: TreasureCardRecord = {
  id: 'new',
  resource: '',
  group: '',
  images: [],
  isFavorite: false,
  type: RECORD_TYPE.CARD,
};

const newBankCardRecord: TreasureBankCardRecord = {
  id: 'new',
  resource: '',
  name: '',
  username: '',
  exp: '',
  password: '',
  group: '',
  isFavorite: false,
  type: RECORD_TYPE.BANK_CARD,
};

export function useRecord({ record, selectedGroup }: { record?: TreasureRecord; selectedGroup?: string }) {
  const { t } = useI18n();

  const recordStore = useRecordStore();
  const { sortedGroups } = storeToRefs(recordStore);

  const isLoading = ref(false);

  const recordData = ref(
    record
      ? cloneDeep(record)
      : selectedGroup && selectedGroup === DEFAULT_GROUP.CARDS
        ? cloneDeep(newCardRecordData)
        : selectedGroup && selectedGroup === DEFAULT_GROUP.BANK_CARDS
          ? cloneDeep(newBankCardRecord)
          : {
              ...cloneDeep(newPasswordRecordData),
              ...(selectedGroup && selectedGroup === DEFAULT_GROUP.FAVORITES && { isFavorite: true }),
              ...(selectedGroup &&
                !([DEFAULT_GROUP.RECENT, DEFAULT_GROUP.FAVORITES] as string[]).includes(selectedGroup) && {
                  group: selectedGroup,
                }),
            },
  );

  const initialRecordData = ref<TreasureRecord>(cloneDeep(recordData.value));

  const images = ref<ProcessedImage[]>(
    record && record.type === 'card'
      ? record.images.map(img => ({
          name: img,
          data: null,
          isNew: false,
        }))
      : [],
  );

  const isFormValid = ref(false);

  const dialogTitle = computed(() => {
    if (recordData.value.type === RECORD_TYPE.CARD) {
      return recordData.value.id === 'new' ? t('recordDialog.title.add_card') : t('recordDialog.title.edit_card');
    }

    if (recordData.value.type === RECORD_TYPE.BANK_CARD) {
      return recordData.value.id === 'new'
        ? t('recordDialog.title.add_bank_card')
        : t('recordDialog.title.edit_bank_card');
    }

    return recordData.value.id === 'new' ? t('recordDialog.title.add') : t('recordDialog.title.edit');
  });

  const otherRecordTypes = computed(() => RECORD_TYPES.filter(r => r.id !== recordData.value.type));

  const isChanged = computed(() => {
    const recordDataFields =
      recordData.value.type === RECORD_TYPE.CARD
        ? Object.keys(newCardRecordData)
        : recordData.value.type === RECORD_TYPE.BANK_CARD
          ? Object.keys(newBankCardRecord)
          : Object.keys(newPasswordRecordData);

    return recordDataFields.some(field => {
      if (field !== 'images') {
        return (
          (recordData.value[field as keyof TreasureRecord] || '') !==
          (initialRecordData.value[field as keyof TreasureRecord] || '')
        );
      }

      const currentImages = (recordData.value as TreasureCardRecord).images;
      const initialImages = (initialRecordData.value as TreasureCardRecord).images;
      const areCurrentImagesValuesChanged = images.value.some(img => img.isNew || img.isTouched);

      return (
        !isEmpty(difference(currentImages, initialImages)) ||
        !isEmpty(difference(initialImages, currentImages)) ||
        areCurrentImagesValuesChanged
      );
    });
  });

  function switchBetweenRecordType(recordType: TreasureRecord['type']) {
    const currentResource = recordData.value.resource;
    const currentGroup = recordData.value.group;
    const isFavorite = recordData.value.isFavorite;
    const id = recordData.value.id;
    images.value = [];

    switch (recordType) {
      case RECORD_TYPE.PASSWORD: {
        recordData.value = cloneDeep(newPasswordRecordData);
        break;
      }

      case RECORD_TYPE.CARD: {
        recordData.value = cloneDeep(newCardRecordData);
        break;
      }

      case RECORD_TYPE.BANK_CARD: {
        recordData.value = cloneDeep(newBankCardRecord);
        break;
      }

      // no default
    }

    recordData.value.id = id;
    recordData.value.resource = currentResource;
    recordData.value.group = currentGroup;
    recordData.value.isFavorite = isFavorite;
  }

  return {
    t,
    isLoading,
    dialogTitle,
    sortedGroups,
    recordData,
    otherRecordTypes,
    images,
    isFormValid,
    isChanged,
    switchBetweenRecordType,
  };
}
