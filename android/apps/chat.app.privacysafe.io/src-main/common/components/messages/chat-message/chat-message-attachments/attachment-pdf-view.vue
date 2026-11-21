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
  import { computed, nextTick, onMounted, ref, useTemplateRef } from 'vue';
  import { useI18n } from 'vue-i18n';
  import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
  import pdfjsWorker from 'pdfjs-dist/legacy/build/pdf.worker.mjs?url';
  import type { PDFDocumentProxy } from 'pdfjs-dist';
  import { Ui3nButton, Ui3nProgressCircular, Ui3nTooltip } from '@v1nt1248/3nclient-lib';
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

  pdfjs.GlobalWorkerOptions.workerSrc = pdfjsWorker;

  const { t } = useI18n();

  let pdfDoc: PDFDocumentProxy | undefined = undefined;

  const isProcessing = ref(true);
  const currentPage = ref(1);
  const totalPage = ref(1);

  const canvasRef = useTemplateRef<HTMLCanvasElement>('canvasEl');
  const canvasStyle = ref({});
  const ctx = computed(() => (canvasRef.value ? canvasRef.value.getContext('2d') : null));

  function renderPage(num = 1) {
    isProcessing.value = true;
    nextTick(() => {
      pdfDoc!
        .getPage(num)
        .then(page => {
          const viewport = page.getViewport({ scale: 1 });

          canvasRef.value!.height = viewport.height;
          canvasRef.value!.width = viewport.width;
          canvasStyle.value = {
            ...(viewport.height >= viewport.width && { height: '100%' }),
            ...(viewport.height < viewport.width && { width: '100%' }),
          };

          const renderTask = page.render({
            canvasContext: ctx.value!,
            canvas: canvasRef.value!,
            viewport,
          });

          return renderTask.promise;
        })
        .then(() => {
          isProcessing.value = false;
        });
    });
  }

  function onPagePrev() {
    if (currentPage.value <= 1) {
      return;
    }

    currentPage.value -= 1;
    renderPage(currentPage.value);
  }

  function onPageNext() {
    if (currentPage.value >= totalPage.value) {
      return;
    }

    currentPage.value += 1;
    renderPage(currentPage.value);
  }

  onMounted(() => {
    getFileByInfoFromMsg(props.item.id!, props.incomingMsgId)
      .then(file => {
        if (!file) {
          isProcessing.value = false;
          emits('error');
          return;
        }

        return (file as web3n.files.ReadonlyFile).readBytes();
      })
      .then(byteArray => {
        if (!byteArray) {
          return;
        }

        return pdfjs.getDocument({ data: byteArray }).promise;
      })
      .then(doc => {
        pdfDoc = doc;
        if (pdfDoc) {
          totalPage.value = pdfDoc.numPages;
        }

        return renderPage(currentPage.value);
      });
  });
</script>

<template>
  <div :class="[$style.pdfView, isMobileMode && $style.mobile]">
    <canvas
      ref="canvasEl"
      :class="$style.canvas"
      :style="canvasStyle"
    />

    <div
      v-if="totalPage > 1"
      :class="$style.actions"
    >
      <div :class="$style.blockBtn">
        <ui3n-tooltip
          :content="t('chat.viewer.btn.pdf.prev')"
          position-strategy="fixed"
          placement="bottom-start"
        >
          <ui3n-button
            type="icon"
            color="var(--color-bg-block-primary-default)"
            icon="round-keyboard-arrow-left"
            icon-size="24"
            icon-color="var(--color-icon-table-primary-default)"
            :disabled="currentPage === 1"
            @click.stop.prevent="onPagePrev"
          />
        </ui3n-tooltip>

        <ui3n-tooltip
          :content="t('chat.viewer.btn.pdf.next')"
          position-strategy="fixed"
          placement="bottom-start"
        >
          <ui3n-button
            type="icon"
            color="var(--color-bg-block-primary-default)"
            icon="round-keyboard-arrow-right"
            icon-size="24"
            icon-color="var(--color-icon-table-primary-default)"
            :disabled="currentPage === totalPage"
            @click.stop.prevent="onPageNext"
          />
        </ui3n-tooltip>
      </div>

      <div :class="$style.info">
        {{ t('chat.viewer.label.page') }}
        <span>{{ currentPage }}</span>
        &nbsp;/&nbsp;
        <span>{{ totalPage }}</span>
      </div>

      <div :class="$style.blockBtn">
&nbsp;
      </div>
    </div>

    <ui3n-progress-circular
      v-if="isProcessing"
      :class="$style.loader"
      indeterminate
      size="108"
    />
  </div>
</template>

<style lang="scss" module>
  .pdfView {
    position: relative;
    width: 100%;
    height: 100%;
    padding: var(--spacing-xxl) var(--spacing-s);
    display: flex;
    justify-content: center;
    align-items: center;

    &.mobile {
      padding: var(--spacing-xl) var(--spacing-s);

      .actions {
        height: var(--spacing-xl);
      }
    }
  }

  .canvas {
    position: relative;
    object-fit: contain;
  }

  .actions {
    position: absolute;
    left: 0;
    width: 100%;
    top: 0;
    height: var(--spacing-xxl);
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0 var(--spacing-s);
  }

  .blockBtn {
    display: flex;
    min-width: 72px;
    justify-content: center;
    align-items: center;
    column-gap: var(--spacing-s);
  }

  .info {
    font-size: var(--font-16);
    color: var(--color-text-control-primary-default);
  }

  .loader {
    position: absolute;
    z-index: 5500;
    left: calc(50% - 54px);
    top: 50%;
    transform: translateY(-50%);
  }
</style>
