<!--
 Copyright (C) 2020 - 2024 3NSoft Inc.

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
-->

<script lang="ts" setup>
  import { computed, ref } from 'vue';
  import { useI18n } from 'vue-i18n';
  import {
    Ui3nCheckbox,
    Ui3nDialog,
    type Ui3nDialogComponentProps,
    type Ui3nDialogEvent,
  } from '@v1nt1248/3nclient-lib';

  const props = defineProps<{
    text?: string;
    dialogProps?: Ui3nDialogComponentProps<boolean>;
  }>();
  const emits = defineEmits<{
    (event: 'action', value: { event: Ui3nDialogEvent; data?: boolean }): void;
  }>();

  const { t } = useI18n();

  const deleteForEveryone = ref(false);

  const bodyText = computed(() => props.text || t('chat.message.dialog.delete.text'));

  function onFlagChange(val: boolean | string | number) {
    emits('action', { event: 'confirm', data: !!val });
  }
</script>

<template>
  <ui3n-dialog
    v-bind="dialogProps"
    @action="emits('action', $event)"
  >
    <template #body>
      <div :class="$style.messageDeleteDialog">
        <div :class="$style.messageDeleteDialogText">
          {{ bodyText }}
        </div>

        <ui3n-checkbox
          v-model="deleteForEveryone as boolean"
          :class="$style.messageDeleteDialogCheckbox"
          @change="onFlagChange"
        >
          {{ t('chat.message.dialog.delete.additional_text') }}
        </ui3n-checkbox>
      </div>
    </template>
  </ui3n-dialog>
</template>

<style lang="scss" module>
  .messageDeleteDialog {
    padding: var(--spacing-l) var(--spacing-m);
  }

  .messageDeleteDialogText {
    font-size: var(--font-12);
    font-weight: 400;
    line-height: var(--font-16);
    color: var(--color-text-block-primary-default);
    margin-bottom: var(--spacing-s);
  }

  .messageDeleteDialogCheckbox {
    --ui3n-checkbox-text-weight: 600;
  }
</style>
