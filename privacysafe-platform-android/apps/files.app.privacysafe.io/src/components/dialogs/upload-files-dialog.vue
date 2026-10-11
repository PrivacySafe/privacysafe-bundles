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
  import { computed, ref, watch } from 'vue';
  import { useI18n } from 'vue-i18n';
  import {
    Ui3nDialog,
    Ui3nDropFiles,
    Ui3nIcon,
    Ui3nInputFile,
    Ui3nProgressLinear,
    Ui3nHtml,
    type Ui3nDialogComponentProps,
    type Ui3nDialogEvent,
  } from '@v1nt1248/3nclient-lib';
  import { getRandomId, getFileExtension, formatFileSize } from '@v1nt1248/3nclient-lib/utils';
  import FileType from '@/components/common/file-type/file-type.vue';

  const vUi3nHtml = Ui3nHtml;

  const props = defineProps<{
    currentFolder: string;
    dialogProps?: Ui3nDialogComponentProps<File[]>;
  }>();

  const emits = defineEmits<{
    (event: 'action', value: { event: Ui3nDialogEvent; data?: File[] }): void;
  }>();

  const { t } = useI18n();

  const files = ref<Record<string, File>>({});
  const isUploading = ref(false);
  const totalSize = ref<number>(0);
  const progress = ref<Record<string, number>>({});

  const currentFolderName = computed(() =>
    props.currentFolder ? props.currentFolder.replaceAll('/', ' / ') : 'Home',
  );

  const uploadedSize = computed(() =>
    Object.keys(progress.value).reduce((acc, id) => {
      const fileSize = files.value[id].size;
      const fileProgress = progress.value[id];
      const uploadedFileSize = (fileSize * fileProgress) / 100;
      acc += uploadedFileSize;
      return acc;
    }, 0),
  );

  function updateProgress(ev: ProgressEvent, id: string): void {
    if (ev.lengthComputable) {
      progress.value[id] = parseFloat(((ev.loaded / ev.total) * 100).toFixed(1));
    }
  }

  function onFilesSelect(value: File[] | FileList) {
    isUploading.value = true;
    totalSize.value = [...value].reduce((acc, f) => {
      acc += f.size;
      return acc;
    }, 0);

    [...value].forEach((file: File) => {
      const id = getRandomId(5);
      if (!files.value[id]) {
        files.value[id] = file;
        const reader = new FileReader();

        const controller = new AbortController();

        reader.addEventListener('loadstart', event => updateProgress(event, id));
        reader.addEventListener('load', event => updateProgress(event, id));
        reader.addEventListener('loadend', () => {
          progress.value[id] = 100;
          controller.abort();
        });
        reader.addEventListener('progress', event => updateProgress(event, id));

        reader.readAsDataURL(file);
      }
    });
  }

  watch(
    () => uploadedSize.value,
    () => {
      if (isUploading.value && uploadedSize.value === totalSize.value) {
        emits('action', { event: 'confirm', data: Object.values(files.value) });
      }
    },
  );
</script>

<template>
  <ui3n-dialog
    v-bind="dialogProps"
    @action="emits('action', $event)"
  >
    <template #body>
      <div :class="$style.uploadFilesDialog">
        <div
          v-if="isUploading"
          :class="$style.uploading"
        >
          <div :class="$style.uploadingHeader">
            <div :class="$style.folderName">
              {{ currentFolderName }}
            </div>

            <div :class="$style.totalProgress">
              {{ totalSize === 0 ? 0 : parseInt(((uploadedSize / totalSize) * 100).toFixed(1)) }}%
            </div>
          </div>

          <div :class="$style.uploadingContent">
            <div
              v-for="(value, id) in progress"
              :key="id"
              :class="$style.uploadingItem"
            >
              <div :class="$style.uploadingItemBody">
                <div :class="$style.uploadingItemLabel">
                  <ui3n-icon
                    icon="round-subject"
                    color="var(--color-icon-table-secondary-default)"
                  />

                  <div :class="$style.uploadingItemName">
                    {{ files[id].name }}
                  </div>
                </div>

                <ui3n-progress-linear :value="value" />
              </div>

              <div :class="$style.uploadingItemType">
                <file-type :file-type="getFileExtension(files[id].name).toLowerCase()" />
              </div>

              <div :class="$style.uploadingItemSize">
                {{ formatFileSize(files[id].size) }}
              </div>
            </div>
          </div>
        </div>

        <ui3n-drop-files
          v-else
          permanent-display
          @select="onFilesSelect"
        >
          <template #additional-text>
            <div :class="$style.additional">
              <span :class="$style.text">
                {{ t('dialog.upload_files.text1') }}: <b>{{ currentFolder ? `/${currentFolder}` : 'Home' }}</b>
              </span>

              <div :class="$style.additionalInfo">
                <span v-ui3n-html="t('dialog.upload_files.text2')" />&nbsp;
                <ui3n-input-file
                  multiple
                  :button-text="t('app.upload_file')"
                  @update:model-value="onFilesSelect"
                />
              </div>
            </div>
          </template>
        </ui3n-drop-files>
      </div>
    </template>
  </ui3n-dialog>
</template>

<style lang="scss" module>
  @use '../../assets/styles/mixins' as mixins;

  .uploadFilesDialog {
    position: relative;
    width: 100%;
    height: 100%;
    padding: var(--spacing-ml);
    border-radius: var(--spacing-ml);
    background-color: var(--color-bg-block-primary-default);
  }

  .uploading {
    position: relative;
    box-sizing: border-box;
    width: 100%;
    height: 100%;
    border-radius: var(--spacing-s);
    border: 1px solid var(--color-border-block-primary-default);
    padding: var(--spacing-ml);
  }

  .uploadingHeader {
    display: flex;
    width: 100%;
    justify-content: space-between;
    align-items: center;
    column-gap: var(--spacing-m);
    color: var(--color-text-control-primary-default);
    margin-bottom: var(--spacing-m);
  }

  .folderName {
    position: relative;
    font-size: var(--font-18);
    font-weight: 400;
    @include mixins.text-overflow-ellipsis();
  }

  .totalProgress {
    position: relative;
    width: 48px;
    font-size: var(--font-16);
    font-weight: 500;
  }

  .uploadingContent {
    position: relative;
    width: 100%;
    height: calc(100% - 40px);
    overflow-y: auto;
  }

  .uploadingItem {
    position: relative;
    width: 100%;
    display: flex;
    justify-content: flex-start;
    align-items: center;
    column-gap: var(--spacing-s);
    color: var(--color-text-control-primary-default);
    padding-right: var(--spacing-s);
    margin-bottom: var(--spacing-m);
  }

  .uploadingItemBody {
    position: relative;
    flex-grow: 1;
  }

  .uploadingItemLabel {
    display: flex;
    width: 100%;
    justify-content: flex-start;
    align-items: center;
    column-gap: var(--spacing-xs);
    margin-bottom: var(--spacing-xs);
  }

  .uploadingItemName {
    font-size: var(--font-12);
    line-height: var(--font-16);
    font-weight: 400;
  }

  .uploadingItemType {
    position: relative;
    width: 40px;
    display: flex;
    justify-content: flex-end;
    align-items: center;
  }

  .uploadingItemSize {
    position: relative;
    width: 72px;
    display: flex;
    justify-content: flex-end;
    align-items: center;
    font-size: var(--font-12);
    font-weight: 600;
  }

  .additional {
    position: relative;
  }

  .text {
    display: inline-block;
    font-size: var(--font-12);
    font-weight: 400;
    color: var(--color-text-table-secondary-default);
    margin-bottom: var(--spacing-s);
  }

  .additionalInfo {
    font-size: var(--font-12);
    font-weight: 500;
    line-height: var(--font-16);
    color: var(--color-text-control-secondary-default);
    display: flex;
    justify-content: center;
    align-items: center;
    column-gap: var(--space-xs);

    span {
      display: inline-block;
    }
  }
</style>
