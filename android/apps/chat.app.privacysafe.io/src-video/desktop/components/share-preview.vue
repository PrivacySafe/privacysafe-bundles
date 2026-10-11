<!--
 Copyright (C) 2025 3NSoft Inc.

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
  import { computed, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from 'vue';
  import type { ScreenShareOption, WindowShareOption } from '@video/common/types';

  const props = defineProps<{
    opts: ScreenShareOption | WindowShareOption;
    /** Currently selected source id (single-select). Controls switch state. */
    activeSrcId?: string | null;
  }>();
  const emits = defineEmits(['selected']);

  const name = computed(() => props.opts.name);
  const thumbnailURL = computed(() => props.opts.thumbnailURL);
  const stream = computed(() => props.opts.stream);
  const appIconURL = computed(() => (props.opts as WindowShareOption)?.appIconURL);

  const videoTag = useTemplateRef<HTMLVideoElement>('video-tag');
  // Fully controlled by parent activeSrcId so failed capture reverts the switch.
  const selected = computed(() =>
    props.activeSrcId !== undefined ? props.activeSrcId === props.opts.srcId : props.opts.initiallySelected,
  );
  const streamIsAttached = ref(false);

  function select() {
    emits('selected', !selected.value);
  }

  async function attachStream(): Promise<void> {
    try {
      const mediaStream = await props.opts.stream;
      if (videoTag.value && mediaStream) {
        videoTag.value.srcObject = mediaStream;
        streamIsAttached.value = true;
      }
    } catch (err) {
      console.error('[SharePreview] Failed to attach stream:', err);
    }
  }

  onMounted(async () => {
    // Attach immediately only for initially shared / already active sources.
    // Other options resolve their deferred stream only after selection.
    if (props.opts.initiallySelected || props.activeSrcId === props.opts.srcId) {
      await attachStream();
    }
  });

  watch([() => props.activeSrcId, () => props.opts.stream], async ([srcId]) => {
    if (srcId !== props.opts.srcId) {
      return;
    }
    await attachStream();
  });

  onBeforeUnmount(async () => {
    try {
      // Never stop initially-shared (live call) streams here — only preview captures.
      if (!selected.value && !props.opts.initiallySelected) {
        const mediaStream = await stream.value.catch(() => undefined);
        if (mediaStream) {
          mediaStream.getTracks().forEach(track => track.stop());
        }
      }
    } catch (err) {
      console.error('[SharePreview] Failed to stop stream in onBeforeUnmount:', err);
    }
  });
</script>

<template>
  <div
    :class="[$style.sharePreview, selected && $style.selected]"
    @click="() => select()"
  >
    <div :class="$style.header">
      <img
        v-if="appIconURL"
        :class="$style.appIcon"
        :src="appIconURL"
        alt="app icon"
      >

      <span>{{ name }}</span>
    </div>

    <div :class="$style.body">
      <video
        v-show="!!streamIsAttached"
        ref="video-tag"
        :class="$style.preview"
        playsinline
        autoplay
        muted
      />

      <img
        v-show="!streamIsAttached"
        :src="thumbnailURL"
        alt="thumbnail url"
        :class="$style.preview"
      >
    </div>

    <div
      v-if="selected"
      :class="$style.info"
    >
      SELECTED
    </div>
  </div>
</template>

<style lang="scss" module>
  @use '@main/common/assets/styles/mixins' as mixins;

  .sharePreview {
    position: relative;
    box-sizing: border-box;
    width: 100%;
    height: 100%;
    padding: var(--spacing-s);
    background-color: var(--color-bg-chat-bubble-general-bg);
    color: var(--color-text-block-primary-default);
    border-radius: var(--spacing-s);
    border: 4px solid transparent;
    cursor: pointer;

    &.selected,
    &:hover {
      border-color: var(--color-border-control-accent-default);
    }
  }

  .header {
    display: flex;
    width: 100%;
    height: var(--spacing-l);
    justify-content: flex-start;
    align-items: center;
    column-gap: var(--spacing-s);
    margin-bottom: var(--spacing-s);

    .appIcon {
      width: var(--spacing-m);
      height: var(--spacing-m);
    }

    span {
      display: block;
      font-size: var(--font-14);
      font-weight: 500;
      @include mixins.text-overflow-ellipsis();
    }
  }

  .body {
    position: relative;
    width: 100%;
    aspect-ratio: 4 / 3;
    overflow: hidden;
  }

  .preview {
    position: relative;
    width: 100%;
    height: 100%;
    object-fit: contain;
    object-position: top;
  }

  .info {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    font-size: var(--font-16);
    font-weight: 600;
    line-height: 1;
    text-transform: uppercase;
    padding: var(--spacing-l) var(--spacing-xl);
    border-radius: var(--spacing-s);
    color: var(--color-text-button-primary-default);
    background-color: var(--color-bg-button-primary-default);
  }
</style>
