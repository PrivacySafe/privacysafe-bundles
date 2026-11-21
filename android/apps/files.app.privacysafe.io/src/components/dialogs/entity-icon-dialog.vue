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
 The editor of a custom icon of an entity: an image is loaded from a file (or
 the current icon is taken), rotated, flipped and cropped to a square. The
 dialog only returns the result; the caller writes it into the entity.
   confirm — data.icon is the new icon (a data URL);
   delete  — the current icon is to be removed.
-->
<script lang="ts" setup>
  import { computed, onBeforeUnmount, ref } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { Cropper } from 'vue-advanced-cropper';
  import 'vue-advanced-cropper/dist/style.css';
  import {
    Ui3nButton,
    Ui3nDialog,
    Ui3nIcon,
    Ui3nTooltip,
    type Ui3nDialogComponentProps,
    type Ui3nDialogEvent,
  } from '@v1nt1248/3nclient-lib';
  import { makeEntityIcon } from '@/utils/entity-icon';
  import { makeLogger } from '@shared/utils/logger';

  export type EntityIconDialogEvent = 'delete';

  export interface EntityIconDialogData {
    icon: string;
  }

  const props = defineProps<{
    icon?: string;
    dialogProps?: Ui3nDialogComponentProps<EntityIconDialogData>;
  }>();

  const emits = defineEmits<{
    (event: 'action', value: { event: Ui3nDialogEvent<EntityIconDialogEvent>; data?: EntityIconDialogData }): void;
  }>();

  const log = makeLogger('EntityIconDialog');
  const { t } = useI18n();

  const fileInputEl = ref<HTMLInputElement | null>(null);
  const cropperRef = ref<InstanceType<typeof Cropper> | null>(null);
  /** The image in the editor: the current icon or an object URL of a loaded file. */
  const imageUrl = ref<string | null>(props.icon ?? null);
  const loadError = ref(false);
  const isSaving = ref(false);

  const hasImage = computed(() => !!imageUrl.value && !loadError.value);

  function revokeObjectUrl() {
    if (imageUrl.value?.startsWith('blob:')) {
      URL.revokeObjectURL(imageUrl.value);
    }
  }

  function openFilePicker() {
    fileInputEl.value?.click();
  }

  function onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    // the same file may be picked again after an edit
    input.value = '';
    if (!file) {
      return;
    }

    revokeObjectUrl();
    loadError.value = !file.type.startsWith('image/');
    imageUrl.value = loadError.value ? null : URL.createObjectURL(file);
  }

  function onImageError() {
    log.error('The selected file could not be read as an image.');
    revokeObjectUrl();
    imageUrl.value = null;
    loadError.value = true;
  }

  function rotate(angle: number) {
    cropperRef.value?.rotate(angle);
  }

  function flip(horizontal: boolean, vertical: boolean) {
    cropperRef.value?.flip(horizontal, vertical);
  }

  function close() {
    emits('action', { event: 'close' });
  }

  function save() {
    const canvas = cropperRef.value?.getResult().canvas;
    if (!canvas) {
      return;
    }
    try {
      isSaving.value = true;
      emits('action', { event: 'confirm', data: { icon: makeEntityIcon(canvas) } });
    } catch (err) {
      log.error('Error making the icon. ', err);
      loadError.value = true;
    } finally {
      isSaving.value = false;
    }
  }

  onBeforeUnmount(revokeObjectUrl);
</script>

<template>
  <ui3n-dialog
    v-bind="dialogProps"
    :title="t('dialog.entity_icon.title')"
    :width="480"
    @action="emits('action', $event)"
  >
    <template #body>
      <div :class="$style.entityIcon">
        <div :class="$style.toolbar">
          <ui3n-button
            type="secondary"
            icon="round-file-upload"
            icon-position="left"
            @click.stop.prevent="openFilePicker"
          >
            {{ t('dialog.entity_icon.button.load') }}
          </ui3n-button>

          <div :class="$style.transforms">
            <ui3n-tooltip
              v-for="action in [
                { icon: 'round-rotate-left', tip: 'rotate_left', run: () => rotate(-90) },
                { icon: 'round-rotate-right', tip: 'rotate_right', run: () => rotate(90) },
                { icon: 'round-flip', tip: 'flip_horizontal', run: () => flip(true, false) },
                { icon: 'round-flip-vertical', tip: 'flip_vertical', run: () => flip(false, true) },
              ]"
              :key="action.icon"
              :content="t(`dialog.entity_icon.button.${action.tip}`)"
              position-strategy="fixed"
              placement="top"
            >
              <ui3n-button
                type="icon"
                color="var(--color-bg-control-secondary-default)"
                :icon="action.icon"
                icon-size="20"
                icon-color="var(--color-icon-control-primary-default)"
                :disabled="!hasImage"
                @click.stop.prevent="action.run"
              />
            </ui3n-tooltip>
          </div>

          <input
            ref="fileInputEl"
            type="file"
            accept="image/*"
            :class="$style.fileInput"
            @change="onFileSelected"
          >
        </div>

        <div :class="$style.editor">
          <cropper
            v-if="hasImage"
            ref="cropperRef"
            :class="$style.cropper"
            :src="imageUrl"
            :stencil-props="{ aspectRatio: 1 }"
            :canvas="{ maxWidth: 1024, maxHeight: 1024 }"
            @error="onImageError"
          />

          <div
            v-else
            :class="$style.placeholder"
            @click.stop.prevent="openFilePicker"
          >
            <ui3n-icon
              icon="outline-image"
              size="48"
              color="var(--color-icon-table-secondary-default)"
            />
            <span :class="loadError && $style.error">
              {{ loadError ? t('dialog.entity_icon.load_error') : t('dialog.entity_icon.no_image') }}
            </span>
          </div>
        </div>
      </div>
    </template>

    <template #actions>
      <div :class="$style.actions">
        <ui3n-button
          v-if="icon"
          type="custom"
          color="var(--error-content-default)"
          text-color="var(--error-fill-default)"
          @click.stop.prevent="emits('action', { event: 'delete' })"
        >
          {{ t('dialog.entity_icon.button.delete') }}
        </ui3n-button>

        <div :class="$style.mainActions">
          <ui3n-button
            type="secondary"
            @click.stop.prevent="close"
          >
            {{ t('dialog.button.cancel') }}
          </ui3n-button>

          <ui3n-button
            :disabled="!hasImage || isSaving"
            @click.stop.prevent="save"
          >
            {{ t('dialog.entity_icon.button.save') }}
          </ui3n-button>
        </div>
      </div>
    </template>
  </ui3n-dialog>
</template>

<style lang="scss" module>
  .entityIcon {
    display: flex;
    flex-direction: column;
    row-gap: var(--spacing-m);
    padding: var(--spacing-m);
  }

  .toolbar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    column-gap: var(--spacing-s);
  }

  .transforms {
    display: flex;
    align-items: center;
    column-gap: var(--spacing-xs);
  }

  .fileInput {
    display: none;
  }

  .editor {
    position: relative;
    width: 100%;
    height: 320px;
    border-radius: var(--spacing-s);
    border: 1px solid var(--color-border-block-primary-default);
    overflow: hidden;
  }

  .cropper {
    width: 100%;
    height: 100%;
  }

  .placeholder {
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    row-gap: var(--spacing-s);
    width: 100%;
    height: 100%;
    cursor: pointer;
    font-size: var(--font-13);
    color: var(--color-text-table-secondary-default);
  }

  .error {
    color: var(--error-content-default);
  }

  .actions {
    display: flex;
    width: 100%;
    padding: 0 var(--spacing-m);
    justify-content: space-between;
    align-items: center;
    column-gap: var(--spacing-s);
  }

  .mainActions {
    display: flex;
    margin-left: auto;
    column-gap: var(--spacing-s);
  }
</style>
