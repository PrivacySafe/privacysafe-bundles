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
  import { onBeforeUnmount, ref, watch } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { Cropper, type CropperResult } from 'vue-advanced-cropper';
  import 'vue-advanced-cropper/dist/style.css';
  import { Ui3nButton } from '@v1nt1248/3nclient-lib';

  const props = defineProps<{
    source: Uint8Array;
  }>();
  const emits = defineEmits<{
    (event: 'cropped', data: Uint8Array): void;
    (event: 'close'): void;
  }>();

  const { t } = useI18n();

  const cropperRef = ref<InstanceType<typeof Cropper> | null>(null);
  const imageUrl = ref<string | null>(null);

  function updateImageSource(bytes: Uint8Array) {
    if (imageUrl.value) {
      URL.revokeObjectURL(imageUrl.value);
    }
    const blob = new Blob([bytes as BlobPart], { type: 'image/jpeg' });
    imageUrl.value = URL.createObjectURL(blob);
  }

  function rotate(angle: number) {
    cropperRef.value?.rotate(angle);
  }

  function flip(horizontal: boolean, vertical: boolean) {
    cropperRef.value?.flip(horizontal, vertical);
  }

  async function handleCrop() {
    if (!cropperRef.value) {
      return;
    }

    const result: CropperResult = cropperRef.value.getResult();
    const canvas = result.canvas;
    if (canvas) {
      canvas.toBlob(
        blob => {
          if (blob) {
            blob.arrayBuffer().then((buffer: ArrayBuffer) => {
              emits('cropped', new Uint8Array(buffer));
            });
          }
        },
        'image/jpeg',
        0.9,
      );
    }
  }

  watch(
    () => props.source,
    val => {
      if (val) {
        updateImageSource(val);
      }
    },
    {
      immediate: true,
    },
  );

  onBeforeUnmount(() => {
    if (imageUrl.value) {
      URL.revokeObjectURL(imageUrl.value);
    }
  });
</script>

<template>
  <div :class="$style.imageEditor">
    <div :class="$style.toolbar">
      <ui3n-button
        type="icon"
        color="var(--color-bg-control-secondary-default)"
        icon="round-rotate-left"
        icon-size="26"
        icon-color="var(--color-icon-control-primary-default)"
        @click.stop.prevent="() => rotate(-90)"
      />

      <ui3n-button
        type="icon"
        color="var(--color-bg-control-secondary-default)"
        icon="round-rotate-right"
        icon-size="26"
        icon-color="var(--color-icon-control-primary-default)"
        @click.stop.prevent="() => rotate(90)"
      />

      <ui3n-button
        type="icon"
        color="var(--color-bg-control-secondary-default)"
        icon="round-flip"
        icon-size="26"
        icon-color="var(--color-icon-control-primary-default)"
        @click.stop.prevent="() => flip(true, false)"
      />

      <ui3n-button
        type="icon"
        color="var(--color-bg-control-secondary-default)"
        icon="round-flip-vertical"
        icon-size="26"
        icon-color="var(--color-icon-control-primary-default)"
        @click.stop.prevent="() => flip(false, true)"
      />
    </div>

    <div :class="$style.cropperWrapper">
      <cropper
        ref="cropperRef"
        :class="$style.cropperContainer"
        :src="imageUrl || ''"
      />
    </div>

    <div :class="$style.actions">
      <ui3n-button
        type="secondary"
        @click.stop.prevent="() => emits('close')"
      >
        {{ t('app.btn.close') }}
      </ui3n-button>

      <ui3n-button
        :disabled="!cropperRef"
        @click.stop.prevent="() => handleCrop()"
      >
        {{ t('app.btn.apply_crop') }}
      </ui3n-button>
    </div>
  </div>
</template>

<style lang="scss" module>
  .imageEditor {
    --image-editor-toolber: 48px;
    --image-editor-actions: 64px;

    position: fixed;
    z-index: 100;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    padding: var(--spacing-m);
    background-color: var(--color-bg-control-secondary-default);
    overflow: hidden;
  }

  .toolbar {
    display: flex;
    width: 100%;
    height: var(--image-editor-toolber);
    justify-content: flex-start;
    align-items: center;
    column-gap: var(--spacing-s);
  }

  .cropperWrapper {
    position: relative;
    width: 100%;
    height: calc(100% - var(--image-editor-toolber) - var(--image-editor-actions));
  }

  .cropperContainer {
    width: 100%;
    height: 100%;
  }

  .actions {
    display: flex;
    width: 100%;
    height: var(--image-editor-actions);
    justify-content: flex-end;
    align-items: center;
    column-gap: var(--spacing-s);
  }
</style>
