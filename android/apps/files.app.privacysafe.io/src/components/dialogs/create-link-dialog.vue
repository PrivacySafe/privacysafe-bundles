<!--
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
-->
<!--
 The data for a new SymLink: its name and its target, a file or a folder picked
 with the platform's file dialogs. The target is the platform's object: it is
 kept raw (not reactive) and is given to fs.link() by the caller.
-->
<script lang="ts" setup>
  import { computed, markRaw, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
  import { useI18n } from 'vue-i18n';
  import {
    Ui3nButton,
    Ui3nDialog,
    Ui3nIcon,
    Ui3nInput,
    Ui3nRadio,
    Ui3nRadioGroup,
    type Ui3nDialogComponentProps,
    type Ui3nDialogEvent,
    type Ui3nRadioValue,
  } from '@v1nt1248/3nclient-lib';
  import { isValidEntityName } from '@shared/utils/fs-utils/entity-name';
  import LinkBadge from '@/components/common/link-badge/link-badge.vue';
  import type { CreateLinkDialogData, LinkTargetType } from '@/utils/create-link';
  import { makeLogger } from '@shared/utils/logger';

  const props = defineProps<{
    checkNameTaken?: (name: string) => Promise<boolean>;
    dialogProps?: Ui3nDialogComponentProps<CreateLinkDialogData>;
  }>();

  const emits = defineEmits<{
    (event: 'action', value: { event: Ui3nDialogEvent; data?: CreateLinkDialogData }): void;
  }>();

  const log = makeLogger('CreateLinkDialog');
  const { t } = useI18n();

  const inpElement = ref<HTMLInputElement | null>(null);
  const name = ref('');
  const isNameFieldValid = ref(false);
  const targetType = ref<LinkTargetType>('folder');
  const target = shallowRef<web3n.files.File | web3n.files.FS | null>(null);
  const isPicking = ref(false);
  /** The name found taken; the check runs while the user types. */
  const takenName = ref<string | null>(null);
  const isCheckingName = ref(false);
  let nameCheckTimer: ReturnType<typeof setTimeout> | undefined;

  const isNameTaken = computed(() => !!name.value && takenName.value === name.value);

  async function checkName(value: string) {
    if (!props.checkNameTaken || !isValidEntityName(value)) {
      isCheckingName.value = false;
      return;
    }
    try {
      const isTaken = await props.checkNameTaken(value);
      // the name may have been changed meanwhile
      if (value === name.value) {
        takenName.value = isTaken ? value : null;
      }
    } catch (err) {
      log.error(`Error checking the name '${value}'. `, err);
    } finally {
      if (value === name.value) {
        isCheckingName.value = false;
      }
    }
  }

  watch(name, value => {
    clearTimeout(nameCheckTimer);
    isCheckingName.value = !!props.checkNameTaken && isValidEntityName(value);
    nameCheckTimer = setTimeout(() => checkName(value), 300);
  });

  onBeforeUnmount(() => clearTimeout(nameCheckTimer));

  const canPick = computed(() =>
    targetType.value === 'folder'
      ? !!w3n.shell?.fileDialogs?.openFolderDialog
      : !!w3n.shell?.fileDialogs?.openFileDialog,
  );

  const isValid = computed(
    () =>
      isNameFieldValid.value &&
      isValidEntityName(name.value) &&
      !isNameTaken.value &&
      !isCheckingName.value &&
      !!target.value,
  );

  const data = computed<CreateLinkDialogData | undefined>(() =>
    target.value ? { name: name.value, target: target.value } : undefined,
  );

  function checkRequired(text?: unknown): boolean | string {
    return !!text || t('validation.text.required');
  }

  function checkNameRule(text?: unknown): boolean | string {
    return !text || isValidEntityName(text) || t('validation.text.invalid_name');
  }

  function changeTargetType(value: Ui3nRadioValue) {
    if (value !== targetType.value) {
      targetType.value = value as LinkTargetType;
      // a target of the other type does not fit any more
      target.value = null;
    }
  }

  async function pickTarget() {
    const fileDialogs = w3n.shell?.fileDialogs;
    if (!fileDialogs || isPicking.value) {
      return;
    }

    isPicking.value = true;
    try {
      const picked =
        targetType.value === 'folder'
          ? await fileDialogs.openFolderDialog?.(
              t('dialog.create_link.picker.folder_title'),
              t('dialog.create_link.picker.button'),
              false,
            )
          : await fileDialogs.openFileDialog?.(
              t('dialog.create_link.picker.file_title'),
              t('dialog.create_link.picker.button'),
              false,
            );

      const item = picked?.[0];
      if (!item) {
        return;
      }

      // a platform object must not be wrapped into a reactive proxy
      target.value = markRaw(item);
      if (!name.value) {
        name.value = item.name;
      }
    } catch (err) {
      log.error('Error selecting the target of a SymLink. ', err);
    } finally {
      isPicking.value = false;
    }
  }

  function onAction(val: { event: Ui3nDialogEvent; data?: CreateLinkDialogData }) {
    emits('action', val);
  }

  function confirmByKeyboard() {
    if (isValid.value && data.value) {
      emits('action', { event: 'confirm', data: data.value });
    }
  }

  onMounted(() => {
    setTimeout(() => inpElement.value?.focus(), 100);
  });
</script>

<template>
  <ui3n-dialog
    v-bind="dialogProps"
    :data="data"
    :is-valid="isValid"
    @action="onAction"
  >
    <template #body>
      <div :class="$style.createLink">
        <ui3n-input
          v-model="name"
          :label="t('dialog.create_link.field.name')"
          :rules="[checkRequired, checkNameRule]"
          :display-state-mode="isNameTaken ? 'error' : undefined"
          :display-state-message="isNameTaken ? t('fs.name_taken', { name }) : ''"
          :placeholder="t('dialog.rename_folder.field.placeholder.input')"
          @init="inpElement = $event"
          @escape="emits('action', { event: 'close' })"
          @enter="confirmByKeyboard"
          @update:valid="isNameFieldValid = $event"
        />

        <div :class="$style.field">
          <div :class="$style.label">
            {{ t('dialog.create_link.field.type') }}
          </div>

          <ui3n-radio-group
            name="link-target-type"
            :model-value="targetType"
            direction="horizontal"
            @update:model-value="changeTargetType"
          >
            <ui3n-radio
              checked-value="folder"
              size="20"
            >
              {{ t('dialog.create_link.type.folder') }}
            </ui3n-radio>

            <ui3n-radio
              checked-value="file"
              size="20"
            >
              {{ t('dialog.create_link.type.file') }}
            </ui3n-radio>
          </ui3n-radio-group>
        </div>

        <div :class="$style.field">
          <div :class="$style.label">
            {{ t('dialog.create_link.field.target') }}
          </div>

          <div :class="$style.target">
            <link-badge>
              <ui3n-icon
                :icon="targetType === 'folder' ? 'round-folder' : 'round-subject'"
                :size="20"
                color="var(--color-icon-table-secondary-default)"
              />
            </link-badge>

            <span :class="[$style.targetName, !target && $style.targetEmpty]">
              {{ target ? target.name : t('dialog.create_link.no_target') }}
            </span>

            <ui3n-button
              type="secondary"
              :disabled="!canPick || isPicking"
              @click="pickTarget"
            >
              {{ t('dialog.create_link.button.select') }}
            </ui3n-button>
          </div>
        </div>
      </div>
    </template>
  </ui3n-dialog>
</template>

<style lang="scss" module>
  .createLink {
    position: relative;
    width: 100%;
    display: flex;
    flex-direction: column;
    row-gap: var(--spacing-m);
    padding: var(--spacing-m);
  }

  .field {
    display: flex;
    flex-direction: column;
    row-gap: var(--spacing-s);

    div[data-ui3n='radio'] {
      div[class*='body'] {
        color: var(--color-icon-block-primary-default);
      }
    }
  }

  .label {
    font-size: var(--font-12);
    font-weight: 500;
    color: var(--color-text-control-secondary-default);
  }

  .target {
    display: flex;
    align-items: center;
    column-gap: var(--spacing-s);
  }

  .targetName {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--font-14);
    color: var(--color-text-control-primary-default);
  }

  .targetEmpty {
    color: var(--color-text-control-secondary-default);
  }
</style>
