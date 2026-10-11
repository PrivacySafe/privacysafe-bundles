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
  import { ref } from 'vue';
  import { useI18n } from 'vue-i18n';
  import size from 'lodash/size';
  import {
    Ui3nDialog,
    type Ui3nDialogComponentProps,
    type Ui3nDialogEvent,
    Ui3nInput,
  } from '@v1nt1248/3nclient-lib';
  import { validationParams } from '../../constants';

  const props = defineProps<{
    chatName: string;
    dialogProps?: Ui3nDialogComponentProps<{ oldName: string; newName: string }>;
  }>();
  const emits = defineEmits<{
    (event: 'action', value: { event: Ui3nDialogEvent; data?: { oldName: string; newName: string } }): void;
  }>();

  const { t } = useI18n();

  const { chatsNameMaxLength } = validationParams;

  const data = ref({ oldName: props.chatName, newName: props.chatName });
  const isValid = ref(false);

  function checkRequired(text?: string): boolean | string {
    return !!text || t('validation.text.required');
  }

  function checkLength(text?: string): boolean | string {
    return (
      size(text) < chatsNameMaxLength || t('validation.text.length', { length: chatsNameMaxLength.toString() })
    );
  }
</script>

<template>
  <ui3n-dialog
    v-bind="dialogProps"
    :data="data"
    :is-valid="isValid"
    @action="emits('action', $event)"
  >
    <template #body>
      <div :class="$style.chatRenameDialog">
        <ui3n-input
          v-model="data.newName"
          :rules="[checkRequired as any, checkLength as any]"
          :placeholder="t('chat.dialog.rename.input_placeholder')"
          @update:valid="(val: boolean) => (isValid = val)"
        />
      </div>
    </template>
  </ui3n-dialog>
</template>

<style lang="scss" module>
  .chatRenameDialog {
    position: relative;
    width: 100%;
    height: 104px;
    padding: var(--spacing-l) var(--spacing-m);
  }
</style>
