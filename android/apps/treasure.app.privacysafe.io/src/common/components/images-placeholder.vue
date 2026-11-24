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
  import { useI18n } from 'vue-i18n';
  import { storeToRefs } from 'pinia';
  import size from 'lodash/size';
  import { Ui3nIcon } from '@v1nt1248/3nclient-lib';
  import { createImageThumbnail, type ImageThumbnail } from '@/common/utils';
  import { useSyncStore } from '@/common/stores/sync.store';

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

  const { t } = useI18n();
  const { imagesRevision } = storeToRefs(useSyncStore());

  /** Indexed like the displayed images; nothing while an image is loading. */
  const thumbnails = ref<(ImageThumbnail | undefined)[]>([]);

  const displayedImagesPlaceholders = computed(() => (props.images || []).slice(0, props.displayedQuantity));
  const diff = computed(() => Math.max(size(props.images) - props.displayedQuantity, 0));

  async function loadThumbnail(imgId: string): Promise<ImageThumbnail> {
    try {
      return await createImageThumbnail(imgId);
    } catch (err) {
      w3n.log('error', `Error creating a thumbnail of the image ${imgId}. `, err);
      return { state: 'missing' };
    }
  }

  let loadingRun = 0;

  function loadInto(run: number, imgId: string, index: number) {
    loadThumbnail(imgId).then(thumbnail => {
      // The images may have changed while this one was loading.
      if (run === loadingRun) {
        thumbnails.value[index] = thumbnail;
      }
    });
  }

  // Each thumbnail is loaded on its own: one image that cannot be read must not
  // keep the others from showing, as it did when they went in one loop.
  //
  // Watched by the ids, not by the array: every reload of the records hands
  // over a new array with the same ids, and the thumbnails would blink back to
  // spinners each time for nothing.
  watch(
    () => displayedImagesPlaceholders.value.join('/'),
    () => {
      const run = ++loadingRun;
      thumbnails.value = [];
      displayedImagesPlaceholders.value.forEach((imgId, index) => loadInto(run, imgId, index));
    },
    {
      immediate: true,
    },
  );

  // An image not shown yet may have come with the synchronization that ended.
  // It keeps what it showed until the new answer comes, so a recheck that
  // changes nothing does not blink.
  watch(imagesRevision, () => {
    displayedImagesPlaceholders.value.forEach((imgId, index) => {
      const thumbnail = thumbnails.value[index];
      if (thumbnail && thumbnail.state !== 'loaded') {
        loadInto(loadingRun, imgId, index);
      }
    });
  });

  function urlOf(index: number): string | undefined {
    const thumbnail = thumbnails.value[index];
    return thumbnail?.state === 'loaded' ? thumbnail.url : undefined;
  }
</script>

<template>
  <div :class="[$style.imagesPlaceholder, disabled && $style.disabled]">
    <div
      v-for="(imgId, index) of displayedImagesPlaceholders"
      :key="imgId"
      :class="$style.placeholderWrapper"
    >
      <img
        v-if="urlOf(index)"
        :src="urlOf(index)"
        :class="$style.placeholder"
        alt="placeholder"
      />

      <ui3n-icon
        v-else-if="thumbnails[index]?.state === 'missing'"
        icon="broken-image-outline"
        size="24"
        color="var(--color-icon-control-secondary-default)"
        :title="t('recordDialog.form.image.unavailable')"
      />

      <ui3n-icon
        v-else
        :title="thumbnails[index]?.state === 'pending' ? t('recordDialog.form.image.pending') : undefined"
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
