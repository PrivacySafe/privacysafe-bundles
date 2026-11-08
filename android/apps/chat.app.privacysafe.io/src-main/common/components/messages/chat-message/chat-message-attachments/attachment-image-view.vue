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
import { transformWeb3nFileToFile } from '@v1nt1248/3nclient-lib/utils';
import { Ui3nProgressCircular } from '@v1nt1248/3nclient-lib';
import type { AttachmentViewInfo } from '@main/common/components/messages/chat-message/chat-message-attachments/types';
import { getFileByInfoFromMsg } from '@main/common/utils/files.helper';

const props = defineProps<{
  item: AttachmentViewInfo;
  incomingMsgId?: string;
  isMobileMode?: boolean;
}>();
const emits = defineEmits<{
  (event: 'error'): void;
}>();

const isProcessing = ref(true);
const imageDataUrl = ref<Nullable<string>>(null);

const imageViewStyle = computed(() => {
  if (!imageDataUrl.value) {
    return {};
  }

  return { backgroundImage: `url('${imageDataUrl.value}')` };
});

onMounted(async () => {
  isProcessing.value = true;

  try {
    const entity = await getFileByInfoFromMsg(props.item.id!, props.incomingMsgId);
    if (!entity) {
      isProcessing.value = false;
      emits('error');
      return null;
    }

    const file = await transformWeb3nFileToFile(entity as web3n.files.ReadonlyFile);
    if (!file) {
      return null;
    }

    imageDataUrl.value = URL.createObjectURL(file);
  } finally {
    isProcessing.value = false;
  }
});
</script>

<template>
  <div :class="[$style.imageView, isMobileMode && $style.mobile]">
    <div
      v-if="imageDataUrl && !isProcessing"
      :class="$style.view"
      :style="imageViewStyle"
    />

    <ui3n-progress-circular
      v-else
      indeterminate
      size="108"
      :class="$style.loader"
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
