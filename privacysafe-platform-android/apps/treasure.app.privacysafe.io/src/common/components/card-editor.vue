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
<script setup lang="ts">
  import { computed, inject, ref, watch } from 'vue';
  import { useI18n } from 'vue-i18n';
  import isEmpty from 'lodash/isEmpty';
  import size from 'lodash/size';
  import { NOTIFICATIONS_KEY } from '@v1nt1248/3nclient-lib/plugins';
  import { getFileExtension, transformWeb3nFileToFile } from '@v1nt1248/3nclient-lib/utils';
  import { Ui3nInput, Ui3nSelector, Ui3nDropFiles, Ui3nButton } from '@v1nt1248/3nclient-lib';
  import type { ProcessedImage, TreasureCardRecord, TreasureGroup, TreasureRecord } from '@shared/@types';
  import ImagePreview from '@/common/components/image-preview.vue';
  import ImageEditor from '@/common/components/image-editor.vue';
  import CustomScrollBar from '@/common/components/custom-scroll-bar.vue';

  const ALLOWED_FILE_TYPES = ['png', 'jpg', 'jpeg'];
  const ALLOWED_QUANTITY = 10;

  const props = defineProps<{
    record: TreasureCardRecord;
    records?: TreasureRecord[];
    sortedGroups: TreasureGroup[];
    images: ProcessedImage[];
    mobileMode?: boolean;
    isLoading?: boolean;
  }>();
  const emits = defineEmits<{
    (event: 'update:record', payload: TreasureRecord): void;
    (event: 'update:images', payload: ProcessedImage[]): void;
    (event: 'update:image', payload: { index: number; data: ProcessedImage }): void;
    (event: 'update:validation-flag', payload: boolean): void;
  }>();

  const { t } = useI18n();
  const { $createNotice } = inject(NOTIFICATIONS_KEY)!;

  const cardNameRules = [(v: unknown) => !!v || t('recordDialog.form.fields.cardName.required')];

  const validation = ref(props.record.id !== 'new');
  const errorMessage = ref('');
  const editableImage = ref<{
    name: string;
    data: Uint8Array;
  } | null>(null);

  const filteredImages = computed(() => props.images.filter(i => !i.toDelete));

  const isFormValid = computed(() => validation.value && !errorMessage.value);

  if (props.record.id !== 'new') {
    doubleValidate();
  }

  function doubleValidate() {
    const currentId = props.record.id;
    const duplicate = (props.records || []).find(r => r.resource === props.record.resource && r.id !== currentId);

    errorMessage.value = duplicate ? t('recordDialog.form.fields.cardName.unique') : '';
  }

  function updateValidation(field: 'resource', val: boolean) {
    validation.value = val;
  }

  function handleInput(field: keyof TreasureRecord, value: string) {
    emits('update:record', {
      ...props.record,
      [field]: value,
    });
    doubleValidate();
  }

  function onFilesSelect(value: FileList | File[]) {
    const allowedFiles: File[] = [];
    const notSupportedFiles: string[] = [];

    for (const file of [...value]) {
      const { name } = file;
      const ext = getFileExtension(name);
      if (ALLOWED_FILE_TYPES.includes(ext)) {
        allowedFiles.push(file);
      } else {
        notSupportedFiles.push(name);
      }
    }

    if (!isEmpty(notSupportedFiles)) {
      $createNotice({
        type: 'warning',
        content: t('recordDialog.form.image.message.unsupported', {
          list: notSupportedFiles.join(', '),
        }),
        duration: 4000,
      });
    }

    const permissibleQuantity = ALLOWED_QUANTITY - size(props.images);
    if (permissibleQuantity < size(allowedFiles)) {
      $createNotice({
        type: 'warning',
        content: t('recordDialog.form.image.message.limit'),
        duration: 4000,
      });
    }

    const updatesImagesData: ProcessedImage[] = allowedFiles
      .slice(0, permissibleQuantity)
      .map(f => ({ name: f.name, isNew: true, data: f }));
    emits('update:images', [...props.images, ...updatesImagesData]);
  }

  function markForDeletion(value: ProcessedImage) {
    const index = props.images.findIndex(f => f.name === value.name);
    if (index >= 0) {
      const image = { ...props.images[index] };
      image.toDelete = true;
      image.isTouched = true;
      emits('update:image', { index, data: image });
    }
  }

  function onProcessed(value: ProcessedImage) {
    const index = props.images.findIndex(f => f.name === value.name);
    if (index >= 0) {
      const image = { ...props.images[index] };
      image.data = value.data;
      emits('update:image', { index, data: image });
    }
  }

  function openImageEditor(filename: string) {
    const index = props.images.findIndex(f => f.name === filename);
    if (index >= 0 && props.images[index].data instanceof Uint8Array) {
      editableImage.value = {
        name: filename,
        data: props.images[index].data,
      };
    }
  }

  function onCrop(data: Uint8Array) {
    const index = props.images.findIndex(f => f.name === editableImage.value?.name);
    if (index >= 0) {
      const image = { ...props.images[index] };
      image.data = data;
      image.isTouched = true;
      editableImage.value = null;
      emits('update:image', { index, data: image });
    }
  }

  watch(
    isFormValid,
    val => {
      emits('update:validation-flag', val);
    },
    {
      immediate: true,
    },
  );

  async function uploadImage() {
    let files: web3n.files.ReadonlyFile[] | undefined;
    try {
      files = await w3n.shell!.fileDialogs!.openFileDialog!(
        t('recordDialog.form.image.upload_custom_card_images'),
        t('recordDialog.form.image.upload_images_btn'),
        true,
        {
          filters: [
            {
              name: 'Images',
              extensions: ALLOWED_FILE_TYPES,
            },
          ],
        },
      );
    } catch (err) {
      w3n.log('error', 'Could not open the dialog to select files', err);
      return;
    }

    if (!files) {
      return;
    }

    try {
      const selectedImgFiles = ref<File[]>([]);

      for (const file of files) {
        const fileData = (await transformWeb3nFileToFile(file)) as File;
        selectedImgFiles.value.push(fileData);
      }

      onFilesSelect(selectedImgFiles.value);
    } catch (error) {
      console.log(error);
    }
  }
</script>

<template>
  <div :class="[$style.cardEditor, isLoading && $style.blurry]">
    <custom-scroll-bar :thumb-height="240">
      <div :class="$style.row">
        <ui3n-input
          :model-value="record.resource"
          :label="`${t('recordDialog.form.fields.cardName.label')}*`"
          :placeholder="t('recordDialog.form.fields.cardName.placeholder')"
          :rules="cardNameRules"
          :display-state-mode="errorMessage ? 'error' : undefined"
          :display-state-message="errorMessage"
          :disabled="isLoading"
          @update:model-value="(v: string) => handleInput('resource', v)"
          @update:valid="(v: boolean) => updateValidation('resource', v)"
        />
      </div>

      <div :class="$style.row">
        <ui3n-selector
          :model-value="record.group"
          :label="t('recordDialog.form.fields.group.label')"
          :placeholder="t('recordDialog.form.fields.group.placeholder')"
          :items="sortedGroups"
          item-display="name"
          clearable
          :disabled="isLoading"
          @update:model-value="(v: string) => handleInput('group', v || '')"
        />
      </div>

      <div
        v-if="!isEmpty(images)"
        :class="[$style.images, mobileMode && $style.imagesMobile]"
      >
        <image-preview
          v-for="img in filteredImages"
          :key="img.name"
          :source="img"
          @processed="(v: ProcessedImage) => onProcessed(v)"
          @delete="(v: ProcessedImage) => markForDeletion(v)"
          @click.stop.prevent="() => openImageEditor(img.name)"
        />
      </div>

      <div :class="[$style.uploadBlock, mobileMode && $style.uploadBlockMobile]">
        <div
          v-if="mobileMode"
          :class="$style.fileUploader"
        >
          <ui3n-button
            type="secondary"
            @click="uploadImage"
          >
            {{ t('recordDialog.form.image.upload_area') }}
          </ui3n-button>
          <span :class="$style.imageInfo">
            {{ t('recordDialog.form.image.info') }}
          </span>
        </div>

        <ui3n-drop-files
          v-else
          title=""
          permanent-display
          @select="onFilesSelect"
        >
          <template #additional-text>
            <div :class="$style.inputFile">
              <div :class="$style.imageInfo">
                {{ t('recordDialog.form.image.info') }}
              </div>

              <ui3n-button
                type="secondary"
                @click="uploadImage"
              >
                {{ t('recordDialog.form.image.upload_btn') }}
              </ui3n-button>
            </div>
          </template>
        </ui3n-drop-files>
      </div>

      <div
        v-if="editableImage"
        :class="$style.imageEditorWrapper"
      >
        <image-editor
          :source="editableImage.data"
          @cropped="(v: Uint8Array) => onCrop(v)"
          @close="() => (editableImage = null)"
        />
      </div>
    </custom-scroll-bar>
  </div>
</template>

<style lang="scss" module>
  .cardEditor {
    position: relative;
    width: 100%;
    max-height: calc(100dvh - 160px);
    padding: var(--spacing-m) 0 var(--spacing-m) var(--spacing-m);

    &.blurry {
      filter: blur(2px);
    }

    .row {
      position: relative;
      width: 100%;
      padding-left: 2px;
      margin-bottom: var(--spacing-s);
    }

    .images {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: var(--spacing-m);
      margin-top: var(--spacing-ml);

      &.imagesMobile {
        grid-template-columns: repeat(2, 1fr);
      }
    }

    .uploadBlock {
      position: relative;
      width: 100%;
      height: 168px;
      margin: var(--spacing-m) 0;

      &.uploadBlockMobile {
        height: 96px;
      }

      .fileUploaderWrapper {
        width: 100% !important;
        height: 100% !important;
      }

      .fileUploader {
        display: flex;
        width: 100%;
        height: 100%;
        flex-direction: column;
        justify-content: center;
        align-items: center;
        padding: var(--spacing-m) var(--spacing-ml);
        border-radius: var(--spacing-s);
        border: 2px dashed var(--color-border-block-primary-default);
      }
    }

    .inputFile {
      font-size: var(--font-12);
      font-weight: 500;
      line-height: var(--font-16);
      color: var(--color-text-control-secondary-default);
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      column-gap: var(--space-xs);

      span {
        display: inline-block;
        user-select: none;
      }
    }

    .imageInfo {
      font-size: var(--font-12);
      font-weight: 500;
      line-height: var(--font-16);
      color: var(--color-text-control-secondary-default);
      text-align: center;
      margin-bottom: var(--spacing-s);
    }

    .imageEditorWrapper {
      position: absolute;
      inset: 0;
      background-color: var(--color-bg-block-primary-default);
    }

    div[class*='scrollbarContainer'] {
      max-height: calc(100dvh - 160px);
      margin-top: -12px;
      padding-top: 12px;
      padding-right: var(--spacing-m);
    }
  }
</style>
