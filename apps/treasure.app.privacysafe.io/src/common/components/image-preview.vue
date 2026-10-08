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
  import { onMounted, ref, watch } from 'vue';
  import { useI18n } from 'vue-i18n';
  import size from 'lodash/size';
  import { Ui3nButton, Ui3nProgressCircular } from '@v1nt1248/3nclient-lib';
  import { appTreasureDenoSrv } from '@/common/services/service-provider';
  import type { ProcessedImage } from '@shared/@types';

  const MAX_IMAGE_SIZE = 1200;

  const props = defineProps<{
    source: ProcessedImage;
  }>();

  const emits = defineEmits<{
    (event: 'processed', payload: ProcessedImage): void;
    (event: 'error', payload: string): void;
    (event: 'click', payload: MouseEvent): void;
    (event: 'delete', payload: ProcessedImage): void;
  }>();

  const { t } = useI18n();

  const previewUrl = ref<string | null>(null);
  const isLoading = ref(false);
  const progress = ref(0);

  async function blobToUint8Array(blob: Blob): Promise<Uint8Array> {
    const buffer = await blob.arrayBuffer();
    return new Uint8Array(buffer);
  }

  function cleanUp() {
    if (previewUrl.value) {
      URL.revokeObjectURL(previewUrl.value);
      previewUrl.value = null;
    }
  }

  async function loadImage(id: string): Promise<void> {
    try {
      isLoading.value = true;
      const data = await appTreasureDenoSrv.loadImage(id);
      await processImage(data || null);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      emits('error', message);
      console.error(message);
    } finally {
      isLoading.value = false;
    }
  }

  async function processImage(data: File | Uint8Array | null) {
    if (!data) {
      cleanUp();
      return;
    }

    isLoading.value = true;
    progress.value = 0;

    try {
      const isUint8 = data instanceof Uint8Array;
      const blob = data instanceof Uint8Array ? new Blob([data as BlobPart]) : data;
      const originalUrl = URL.createObjectURL(blob);

      const img = new Image();
      img.src = originalUrl;

      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error(`Image could not be loaded`));
      });

      const needsResize = data instanceof File && (img.width > MAX_IMAGE_SIZE || img.height > MAX_IMAGE_SIZE);

      if (needsResize) {
        const canvas = document.createElement('canvas');
        let { width, height } = img;

        if (width > height) {
          if (width > MAX_IMAGE_SIZE) {
            height *= MAX_IMAGE_SIZE / width;
            width = MAX_IMAGE_SIZE;
          }
        } else {
          if (height > MAX_IMAGE_SIZE) {
            width *= MAX_IMAGE_SIZE / height;
            height = MAX_IMAGE_SIZE;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          throw new Error('Failed to get Canvas context');
        }

        progress.value = 50;
        ctx.drawImage(img, 0, 0, width, height);

        const resizedBlob = await new Promise<Blob | null>(resolve => {
          canvas.toBlob(b => resolve(b), 'image/jpeg', 0.9);
        });

        cleanUp();
        if (resizedBlob) {
          previewUrl.value = URL.createObjectURL(resizedBlob);
          const fileData = await blobToUint8Array(resizedBlob);
          emits('processed', { name: props.source.name, data: fileData });
        }
      } else {
        cleanUp();
        previewUrl.value = originalUrl;
        const fileData = isUint8 ? data : await blobToUint8Array(data as File);
        emits('processed', { name: props.source.name, data: fileData });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      emits('error', message);
      console.error(message);
    } finally {
      isLoading.value = false;
      progress.value = 100;
    }
  }

  watch(
    () => props.source?.name,
    (val, oldVal) => {
      if (val && val !== oldVal && props.source.data) {
        processImage(props.source.data);
      } else if (val && val !== oldVal && props.source.data === null) {
        loadImage(val);
      }
    },
    {
      immediate: true,
    },
  );

  watch(
    () => props.source?.data,
    (val, oldVal) => {
      if (size(val) !== size(oldVal)) {
        processImage(val);
      }
    },
    {
      immediate: true,
    },
  );

  onMounted(cleanUp);
</script>

<template>
  <div
    :class="$style.previewContainer"
    v-on="isLoading ? {} : { click: (ev: MouseEvent) => emits('click', ev) }"
  >
    <div
      v-if="isLoading"
      :class="$style.loader"
    >
      <span :class="$style.loaderText">{{ t('recordDialog.form.image.uploading') }}</span>
      <ui3n-progress-circular
        size="48"
        :value="progress"
      />
    </div>

    <img
      v-if="previewUrl && !isLoading"
      :src="previewUrl"
      :class="$style.previewImg"
      alt="Preview"
    />

    <ui3n-button
      type="icon"
      color="var(--color-bg-control-secondary-default)"
      icon="trash-can"
      icon-color="var(--error-content-default)"
      icon-size="24"
      :class="$style.del"
      @click.stop.prevent="() => emits('delete', source)"
    />
  </div>
</template>

<style lang="scss" module>
  .previewContainer {
    position: relative;
    width: 100%;
    max-width: 172px;
    aspect-ratio: 1 / 1;
    border: 2px dashed var(--color-border-block-primary-default);
    border-radius: var(--spacing-m);
    overflow: hidden;
    background-color: var(--color-bg-control-secondary-default);
    cursor: pointer;
  }

  .loader {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    row-gap: var(--spacing-m);

    .loaderText {
      font-size: var(--font-14);
      font-weight: 500;
      line-height: var(--font-18);
      color: var(--color-text-table-secondary-default);
    }
  }

  .previewImg {
    width: 100%;
    height: 100%;
    object-fit: contain;
  }

  .del {
    position: absolute !important;
    top: var(--spacing-xs);
    right: var(--spacing-xs);
    z-index: 1;
  }
</style>
