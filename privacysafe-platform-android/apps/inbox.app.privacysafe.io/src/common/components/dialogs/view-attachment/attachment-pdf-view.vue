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
  import { Ui3nButton, Ui3nTooltip } from '@v1nt1248/3nclient-lib';
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

  pdfjs.GlobalWorkerOptions.workerSrc = pdfjsWorker;

  const { t } = useI18n();

  let pdfDoc: PDFDocumentProxy | undefined = undefined;

  const isProcessing = ref(true);
  const currentPage = ref(1);
  const totalPage = ref(1);

  const { isLoading, percent, progress, loadBytes, cancel } = useAttachmentContent({
    item: props.item,
    incomingMsgId: props.incomingMsgId,
  });

  function onCancel() {
    cancel();
    emits('cancel');
  }

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

  onMounted(async () => {
    const bytes = await loadBytes();
    if (!bytes) {
      // Cancelled, or the file is not there; the dialog reports the latter.
      isProcessing.value = false;
      return;
    }

    pdfDoc = await pdfjs.getDocument({ data: bytes }).promise;
    totalPage.value = pdfDoc.numPages;
    renderPage(currentPage.value);
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
          :content="t('chat.pdf.view.btn.prev')"
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
          :content="t('chat.pdf.view.btn.next')"
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
        {{ t('chat.pdf.view.page') }}
        <span>{{ currentPage }}</span>
        &nbsp;/&nbsp;
        <span>{{ totalPage }}</span>
      </div>

      <div :class="$style.blockBtn">
        &nbsp;
      </div>
    </div>

    <attachment-loading
      v-if="isProcessing"
      :reading="isLoading"
      :percent="percent"
      :progress="progress"
      @cancel="onCancel"
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
