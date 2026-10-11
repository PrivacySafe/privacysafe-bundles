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
  import { computed, onMounted, ref, useTemplateRef } from 'vue';
  import { useSwipe, type UseSwipeDirection } from '@vueuse/core';
  import size from 'lodash/size';
  import { Ui3nButton, Ui3nIcon } from '@v1nt1248/3nclient-lib';
  import { appTreasureDenoSrv } from '@/common/services/service-provider';

  const props = defineProps<{
    imageIds: string[];
    mobileMode?: boolean;
  }>();
  const emits = defineEmits<{
    (event: 'close'): void;
  }>();

  const target = useTemplateRef('container');
  const isLoading = ref(false);
  const currentImgIndex = ref(0);
  const imgSrc = ref('');
  const rotateAngle = ref(0);

  const isSideways = computed(() => (rotateAngle.value / 90) % 2 !== 0);

  const imgStyle = computed(() => {
    if (!isSideways.value) {
      return {
        transform: `rotate(${rotateAngle.value}deg)`,
        width: '100%',
        height: '100%',
      };
    }

    return {
      transform: `rotate(${rotateAngle.value}deg)`,
      width: '100cqh',
      height: '100cqw',
    };
  });

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { direction, isSwiping, lengthX, lengthY } = useSwipe(target, {
    passive: false,
    onSwipeEnd(e: TouchEvent, direction: UseSwipeDirection) {
      const dir = direction === 'left' ? 'next' : direction === 'right' ? 'prev' : '-';
      if (dir !== '-') {
        step(dir);
      }
    },
  });

  async function loadImage(imageId: string): Promise<string> {
    isLoading.value = true;

    imgSrc.value = '';
    const imageBytes = await appTreasureDenoSrv.loadImage(imageId);
    if (!imageBytes) {
      isLoading.value = false;
      return '';
    }

    const blob = new Blob([imageBytes as BlobPart]);

    const bitmap = await createImageBitmap(blob, {
      imageOrientation: 'from-image',
      premultiplyAlpha: 'none',
    });

    try {
      const scale = 1200 / Math.max(bitmap.width, bitmap.height);
      const width = bitmap.width * scale;
      const height = bitmap.height * scale;

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext('2d', { alpha: true });
      if (!ctx) {
        throw new Error('Canvas context failed');
      }

      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';

      ctx.drawImage(bitmap, 0, 0, width, height);

      return canvas.toDataURL('image/webp', 0.8);
    } finally {
      bitmap.close();
      isLoading.value = false;
    }
  }

  async function step(direction: 'prev' | 'next') {
    console.log('step => ', direction);
    const currentImageIndex = currentImgIndex.value;
    if (direction === 'next' && currentImgIndex.value < size(props.imageIds) - 1) {
      currentImgIndex.value += 1;
    }

    if (direction === 'prev' && currentImgIndex.value > 0) {
      currentImgIndex.value -= 1;
    }

    if (currentImageIndex !== currentImgIndex.value) {
      rotateAngle.value = 0;
      imgSrc.value = await loadImage(props.imageIds[currentImgIndex.value]);
    }
  }

  function rotate(direction: 'left' | 'right') {
    if (direction === 'left') {
      rotateAngle.value -= 90;
    } else {
      rotateAngle.value += 90;
    }
  }

  onMounted(async () => {
    imgSrc.value = await loadImage(props.imageIds[currentImgIndex.value]);
  });
</script>

<template>
  <section :class="[$style.imagesSlider, mobileMode && $style.mobileMode]">
    <div
      v-if="mobileMode"
      :class="$style.toolbar"
    >
      <ui3n-button
        type="icon"
        color="var(--color-bg-block-primary-default)"
        icon="round-arrow-back"
        icon-size="20"
        icon-color="var(--color-icon-table-primary-default)"
        @click.stop.prevent="() => emits('close')"
      />

      <div :class="$style.block">
        <ui3n-button
          type="icon"
          color="var(--color-bg-block-primary-default)"
          icon="round-rotate-left"
          icon-size="20"
          icon-color="var(--color-icon-table-primary-default)"
          @click.stop.prevent="() => rotate('left')"
        />

        <ui3n-button
          type="icon"
          color="var(--color-bg-block-primary-default)"
          icon="round-rotate-right"
          icon-size="20"
          icon-color="var(--color-icon-table-primary-default)"
          @click.stop.prevent="() => rotate('right')"
        />
      </div>
    </div>

    <div
      ref="container"
      :class="$style.content"
    >
      <transition
        name="cross-fade"
        mode="out-in"
      >
        <ui3n-icon
          v-if="isLoading"
          icon="spinner"
          size="120"
          color="var(--color-icon-table-secondary-default)"
        />

        <template v-else>
          <img
            v-if="imgSrc"
            :src="imgSrc"
            :style="imgStyle"
            :class="$style.image"
            alt="image"
          />
        </template>
      </transition>
    </div>

    <template v-if="!mobileMode">
      <ui3n-button
        v-if="currentImgIndex > 0"
        type="icon"
        color="var(--color-bg-block-primary-default)"
        icon="round-arrow-back"
        icon-size="24"
        icon-color="var(--color-icon-table-primary-default)"
        :class="[$style.action, $style.left]"
        @click.stop.prevent="() => step('prev')"
      />

      <ui3n-button
        v-if="currentImgIndex < size(imageIds) - 1"
        type="icon"
        color="var(--color-bg-block-primary-default)"
        icon="round-arrow-forward"
        icon-size="24"
        icon-color="var(--color-icon-table-primary-default)"
        :class="[$style.action, $style.right]"
        @click.stop.prevent="() => step('next')"
      />

      <ui3n-button
        type="icon"
        color="var(--color-bg-block-primary-default)"
        icon="round-close"
        icon-size="24"
        icon-color="var(--color-icon-table-primary-default)"
        :class="$style.close"
        @click.stop.prevent="() => emits('close')"
      />
    </template>

    <div
      v-if="mobileMode && size(imageIds) > 1"
      :class="$style.pagination"
    >
      <span
        v-for="page in size(imageIds)"
        :key="page"
        :class="[$style.dot, currentImgIndex === page - 1 && $style.active]"
      />
    </div>
  </section>
</template>

<style lang="scss" module>
  .imagesSlider {
    --images-slider-toolbar: 48px;
    --images-slider-pagination: 32px;

    position: fixed;
    left: 0;
    top: 0;
    width: 100%;
    height: 100dvh;
    z-index: 100;
    background-color: var(--color-bg-block-primary-default);
    padding: var(--spacing-m) var(--spacing-xxl);

    &.mobileMode {
      padding: 0 var(--spacing-s);

      .content {
        height: calc(100% - var(--images-slider-toolbar) - var(--images-slider-pagination));
        user-select: none;
        -webkit-user-drag: none;
      }
    }
  }

  .toolbar {
    display: flex;
    width: 100%;
    height: var(--images-slider-toolbar);
    padding: 0;
    justify-content: space-between;
    align-items: center;
    border-bottom: 1px solid var(--color-border-block-primary-default);
  }

  .block {
    display: flex;
    justify-content: center;
    align-items: center;
    column-gap: var(--spacing-s);
  }

  .content {
    position: relative;
    width: 100%;
    height: 100%;
    background-color: var(--color-bg-block-tritery-default);
    display: flex;
    justify-content: center;
    align-items: center;
    overflow: hidden;
    container-type: size;
  }

  .close {
    position: absolute !important;
    top: var(--spacing-xs);
    right: var(--spacing-xs);
  }

  .action {
    position: absolute !important;
    top: calc(50% - 16px);
  }

  .left {
    left: 8px;
  }

  .right {
    right: 8px;
  }

  .image {
    user-select: none;
    -webkit-user-drag: none;
    object-fit: contain;
    transition:
      transform 0.3s ease,
      width 0.3s ease,
      height 0.3s ease;
    cursor: pointer;
  }

  .pagination {
    display: flex;
    width: 100%;
    height: var(--images-slider-pagination);
    justify-content: center;
    align-items: center;
    column-gap: var(--spacing-s);

    .dot {
      position: relative;
      width: var(--spacing-s);
      height: var(--spacing-s);
      border-radius: 50%;
      background-color: var(--color-icon-control-secondary-default);
      transition: 0.3s cubic-bezier(0.4, 0, 0.2, 1);

      &.active {
        background: var(--color-icon-control-accent-default);
        transform: scale(1.4);
      }
    }
  }
</style>
