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
  import { computed, onMounted, ref } from 'vue';
  import type { Nullable } from '@v1nt1248/3nclient-lib';
  import { useAttachmentContent } from '@common/composables/useAttachmentContent';
  import AttachmentLoading from './attachment-loading.vue';
  import type { AttachmentInfo } from '@common/types';

  const props = defineProps<{
    item: AttachmentInfo;
    incomingMsgId?: string;
    isMobileMode?: boolean;
  }>();

  const emits = defineEmits<{
    (event: 'cancel'): void;
  }>();

  const imageDataUrl = ref<Nullable<string>>(null);

  const { isLoading, percent, progress, loadBytes, objectUrlFor, cancel } = useAttachmentContent({
    item: props.item,
    incomingMsgId: props.incomingMsgId,
  });

  function onCancel() {
    cancel();
    emits('cancel');
  }

  const imageViewStyle = computed(() => {
    if (!imageDataUrl.value) {
      return {};
    }

    return { backgroundImage: `url('${imageDataUrl.value}')` };
  });

  onMounted(async () => {
    const bytes = await loadBytes();
    if (bytes) {
      imageDataUrl.value = objectUrlFor(bytes);
    }
  });
</script>

<template>
  <div :class="[$style.imageView, isMobileMode && $style.mobile]">
    <div
      v-if="imageDataUrl && !isLoading"
      :class="$style.view"
      :style="imageViewStyle"
    />

    <attachment-loading
      v-else
      :reading="isLoading"
      :percent="percent"
      :progress="progress"
      @cancel="onCancel"
    />
  </div>
</template>

<style lang="scss" module>
  .imageView {
    position: relative;
    width: 100%;
    height: 100%;
    padding: var(--spacing-xxl) var(--spacing-s);

    &.mobile {
      padding: var(--spacing-xl) var(--spacing-s);
    }
  }

  .view {
    position: relative;
    width: 100%;
    height: 100%;
    background-position: center;
    background-size: contain;
    background-repeat: no-repeat;
  }

  .loader {
    position: absolute;
    z-index: 5500;
    left: calc(50% - 54px);
    top: 50%;
    transform: translateY(-50%);
  }
</style>
