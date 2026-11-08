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
  import { computed, ref, watch } from 'vue';
  import size from 'lodash/size';
  import { Ui3nIcon } from '@v1nt1248/3nclient-lib';
  import { createImageThumbnail } from '@/common/utils';

  const props = withDefaults(
    defineProps<{
      images: string[];
      displayedQuantity?: number;
      disabled?: boolean;
    }>(),
    {
      displayedQuantity: 3,
    },
  );

  const imagesPlaceholders = ref<string[]>([]);

  const displayedImagesPlaceholders = computed(() => (props.images || []).slice(0, props.displayedQuantity));
  const diff = computed(() => Math.max(size(props.images) - props.displayedQuantity, 0));

  watch(
    () => props.images,
    async () => {
      for (const imgId of displayedImagesPlaceholders.value) {
        const thumbnail = await createImageThumbnail(imgId);
        imagesPlaceholders.value.push(thumbnail);
      }
    },
    {
      immediate: true,
    },
  );
</script>

<template>
  <div :class="[$style.imagesPlaceholder, disabled && $style.disabled]">
    <div
      v-for="(imgId, index) of displayedImagesPlaceholders"
      :key="imgId"
      :class="$style.placeholderWrapper"
    >
      <img
        v-if="imagesPlaceholders[index]"
        :src="imagesPlaceholders[index]"
        :class="$style.placeholder"
        alt="placeholder"
      />

      <ui3n-icon
        v-else
        icon="spinner-blocks-wave"
        size="32"
        color="var(--color-icon-button-secondary-default)"
      />
    </div>

    <span
      v-if="diff > 0"
      :class="$style.text"
    >
      + {{ diff }}
    </span>
  </div>
</template>

<style lang="scss" module>
  .imagesPlaceholder {
    --img-placeholder-size: 40px;

    position: relative;
    width: 100%;
    height: 100%;
    display: flex;
    justify-content: flex-start;
    align-items: center;
    column-gap: var(--spacing-s);

    &.disabled {
      pointer-events: none;
      cursor: default;
      opacity: 0.5;
    }
  }

  .placeholderWrapper {
    position: relative;
    width: var(--img-placeholder-size);
    min-width: var(--img-placeholder-size);
    height: var(--img-placeholder-size);
    border-radius: var(--spacing-s);
    overflow: hidden;
    border: 1px solid var(--color-border-block-primary-default);
    display: flex;
    justify-content: center;
    align-items: center;
  }

  .placeholder {
    width: 100%;
    height: 100%;
    object-fit: cover;
    filter: blur(2px) contrast(1.3) brightness(0.95) sepia(0.2);
    overflow: hidden;
    will-change: filter;
    backface-visibility: hidden;
  }

  .text {
    font-size: var(--font-16);
    font-weight: 600;
    color: var(--color-text-control-primary-default);
  }
</style>
