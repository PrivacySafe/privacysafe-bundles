<!--
 Copyright (C) 2024 - 2025 3NSoft Inc.

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
  import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
  import { useI18n } from 'vue-i18n';
  import {
    Ui3nDialog,
    Ui3nInput,
    type Ui3nDialogComponentProps,
    type Ui3nDialogEvent,
  } from '@v1nt1248/3nclient-lib';
  import { isValidEntityName } from '@shared/utils/fs-utils/entity-name';
  import { makeLogger } from '@shared/utils/logger';

  const log = makeLogger('FolderNameDialog');

  const props = defineProps<{
    name: string;
    /** Tells whether the name is taken in the target folder; checked while the user types. */
    checkNameTaken?: (name: string) => Promise<boolean>;
    dialogProps?: Ui3nDialogComponentProps<{ oldName: string; newName: string }>;
  }>();

  const emits = defineEmits<{
    (event: 'action', value: { event: Ui3nDialogEvent; data?: { oldName: string; newName: string } }): void;
  }>();

  const { t } = useI18n();

  const inp = ref();
  const inpElement = ref<HTMLInputElement | null>(null);
  const data = ref({ oldName: props.name, newName: props.name });
  const isValid = ref(false);

  /** The name found taken; the dialog stays open, the field shows the error. */
  const takenName = ref<string | null>(null);
  const isCheckingName = ref(false);
  let nameCheckTimer: ReturnType<typeof setTimeout> | undefined;

  const isNameTaken = computed(() => !!data.value.newName && takenName.value === data.value.newName);

  async function runNameCheck(value: string) {
    if (!props.checkNameTaken || !isValidEntityName(value)) {
      isCheckingName.value = false;
      return;
    }
    try {
      const isTaken = await props.checkNameTaken(value);
      // the name may have been changed meanwhile
      if (value === data.value.newName) {
        takenName.value = isTaken ? value : null;
      }
    } catch (err) {
      log.error(`Error checking the name '${value}'. `, err);
    } finally {
      if (value === data.value.newName) {
        isCheckingName.value = false;
      }
    }
  }

  watch(
    () => data.value.newName,
    value => {
      clearTimeout(nameCheckTimer);
      isCheckingName.value = !!props.checkNameTaken && isValidEntityName(value);
      nameCheckTimer = setTimeout(() => runNameCheck(value), 300);
    },
  );

  onBeforeUnmount(() => clearTimeout(nameCheckTimer));

  const isFolderNameValid = computed(
    () => inp.value?.isDirty && isValid.value && !isNameTaken.value && !isCheckingName.value,
  );

  function checkRequired(text?: unknown): boolean | string {
    return !!text || t('validation.text.required');
  }

  function checkName(text?: unknown): boolean | string {
    return !text || isValidEntityName(text) || t('validation.text.invalid_name');
  }

  function onValidUpdate(val: boolean) {
    isValid.value = val;
  }

  function onAction(val: { event: Ui3nDialogEvent; data?: { oldName: string; newName: string } }) {
    emits('action', val);
  }

  function updateByKeyboard() {
    if (data.value.newName && isFolderNameValid.value) {
      emits('action', { event: 'confirm', data: data.value });
    }
  }

  onMounted(() => {
    if (inpElement.value) {
      setTimeout(() => {
        inpElement.value!.focus();
      }, 100);
    }
  });
</script>

<template>
  <ui3n-dialog
    v-bind="dialogProps"
    :data="data"
    :is-valid="isFolderNameValid"
    @action="onAction"
  >
    <template #body>
      <div :class="$style.updateFolderName">
        <ui3n-input
          ref="inp"
          v-model="data.newName"
          :autofocus="true"
          :rules="[checkRequired, checkName]"
          :display-state-mode="isNameTaken ? 'error' : undefined"
          :display-state-message="isNameTaken ? t('fs.name_taken', { name: data.newName }) : ''"
          :placeholder="t('dialog.rename_folder.field.placeholder.input')"
          :class="$style.input"
          @init="inpElement = $event"
          @escape="emits('action', { event: 'close' })"
          @enter="updateByKeyboard"
          @update:valid="onValidUpdate"
        />
      </div>
    </template>
  </ui3n-dialog>
</template>

<style lang="scss" module>
  .updateFolderName {
    position: relative;
    width: 100%;
    height: calc(var(--base-size) * 5);
    padding: var(--spacing-m);
  }

  .input {
    & > div {
      top: 35px !important;
    }
  }
</style>
